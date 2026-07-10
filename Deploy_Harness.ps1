# Deploy_Harness.ps1
# Self-heal deploy: turn the current DEV code into a new immutable release and go live with it,
# safely. If the new version fails to come up, automatically roll back to the previous one.
#
#   1. Snapshot dev (portal/ + docgraph/) -> .releases\v(N+1)
#   2. node --check the new server.js (syntax gate)
#   3. Smoke test: boot the release on a SEPARATE port (3399) with a TEMP HARNESS_HOME
#      (so it never touches production data), wait for /api/ping, then kill it
#   4. Promote: current.json -> v(N+1)
#   5. Restart production: stop :3300, start the new release detached on :3300
#   6. Health check :3300 -> record last-known-good + lock the release read-only
#   7. If it can't be confirmed live after promote: when a supervisor owns the process, TRUST it (it has
#      its own crash-loop fallback to last-known-good) and NEVER self-rollback; only in no-supervisor
#      mode do we revert current.json + restart the previous version ourselves (rollback).
#
# Hana runs this after editing the dev tree. The browser auto-reloads (bootId) when :3300 restarts.

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\_harness-release-lib.ps1"

$PROD_PORT  = if ($env:HARNESS_PORT) { [int]$env:HARNESS_PORT } else { 3300 }
$SMOKE_PORT = if ($env:HARNESS_SMOKE_PORT) { [int]$env:HARNESS_SMOKE_PORT } else { 3399 }
$HOME_DIR   = Get-HarnessRoot

function Say { param([string]$m, [string]$c = "Gray") Write-Host $m -ForegroundColor $c }

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "     Harness Deploy  (self-heal release)" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan

$prev = Get-CurrentVersion
$next = Get-NextVersion
Say ("  Previous : {0}" -f $(if ($prev) { $prev } else { "(none)" }))
Say ("  New      : {0}" -f $next)
Say ("  Prod port: {0}   Smoke port: {1}" -f $PROD_PORT, $SMOKE_PORT)
Write-Host "----------------------------------------------------------" -ForegroundColor DarkGray

# 1. Snapshot ------------------------------------------------------------------
Say "[1/7] Snapshotting dev source -> $next ..."
$releaseDir = New-HarnessSnapshot $next
Say ("      copied to {0}" -f $releaseDir) "DarkGray"

# 2. Syntax gate ---------------------------------------------------------------
Say "[2/7] node --check ..."
$relServer = Join-Path $releaseDir "portal\server.js"
node --check $relServer
if ($LASTEXITCODE -ne 0) {
    Say "[X] Syntax check failed. Aborting (no changes to production)." "Red"
    Remove-Item -Recurse -Force $releaseDir -ErrorAction SilentlyContinue
    exit 1
}
Say "      OK" "DarkGray"

# 3. Smoke test on a separate port + throwaway HARNESS_HOME --------------------
Say "[3/7] Smoke test on :$SMOKE_PORT (isolated data) ..."
$smokeHome = Join-Path ([System.IO.Path]::GetTempPath()) ("harness-smoke-" + [System.Guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Force -Path $smokeHome | Out-Null
$smokeProc = $null
$smokeOk = $false
try {
    Stop-HarnessOnPort $SMOKE_PORT
    $smokeProc = Start-HarnessRelease -Version $next -Port $SMOKE_PORT -HarnessHome $smokeHome
    $boot = Test-HarnessHealth -Port $SMOKE_PORT -TimeoutSec 25
    if ($boot) { $smokeOk = $true; Say ("      healthy (bootId {0})" -f $boot) "DarkGray" }
} finally {
    if ($smokeProc -and -not $smokeProc.HasExited) { Stop-Process -Id $smokeProc.Id -Force -ErrorAction SilentlyContinue }
    Stop-HarnessOnPort $SMOKE_PORT
    Remove-Item -Recurse -Force $smokeHome -ErrorAction SilentlyContinue
}
if (-not $smokeOk) {
    Say "[X] Smoke test failed. New release will NOT go live. Production untouched." "Red"
    Say ("    (Inspect the candidate at {0}, then re-run after fixing dev.)" -f $releaseDir) "Yellow"
    exit 1
}

# 4. Promote -------------------------------------------------------------------
Say "[4/6] Promoting current -> $next ..."
Set-CurrentVersion $next

# 5. Go live -------------------------------------------------------------------
# If a supervisor (Start_Harness.ps1) owns the process, this asks it to restart onto $next; otherwise
# it manages the server process directly. Returns the new bootId once :3300 answers again.
Say "[5/6] Going live on :$PROD_PORT ..."
$prodBoot = Switch-LiveVersion -Version $next -Port $PROD_PORT -HarnessHome $HOME_DIR -Reason ("deploy-" + $next)

# SUPERVISOR mode: the restart was SIGNALED; the supervisor owns bringing it up AND has its own
# crash-loop fallback to last-known-good. Switch-LiveVersion returns the new bootId (saw it), "STAGED"
# (signaled but not seen within 90s — trust the supervisor), or "DEFERRED" (queued behind a live turn).
# In ALL these cases we DO NOT roll back ourselves — that race is exactly what wedged the supervisor.
if ($prodBoot -eq "DEFERRED" -or $prodBoot -eq "STAGED") {
    Lock-HarnessRelease $next
    Write-Host "----------------------------------------------------------" -ForegroundColor DarkGray
    if ($prodBoot -eq "DEFERRED") {
        Say ("[OK] {0} promoted and locked. It will take effect after current conversation ends." -f $next) "Green"
    } else {
        Say ("[OK] {0} promoted and locked. Supervisor notified to restart. Going live..." -f $next) "Green"
    }
    Say "     Will record as last-known-good after 30s of healthy uptime. Auto-rollback if it fails." "DarkGray"
    exit 0
}

# Saw a real bootId — confirm it's actually $next (the supervisor may have crash-loop-fallen-back to lkg).
# A single ping can transiently miss while the supervisor is mid-relaunch or the box is CPU-bound, which
# used to falsely fail the confirm and trigger a rollback. Poll for up to 60s before judging.
$liveVer = $null
if ($prodBoot) {
    $confirmDeadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $confirmDeadline -and -not $liveVer) {
        try { $liveVer = (Invoke-RestMethod -Uri ("http://localhost:{0}/api/ping" -f $PROD_PORT) -TimeoutSec 3).version } catch { }
        if (-not $liveVer) { Start-Sleep -Milliseconds 800 }
    }
}
if ($prodBoot -and ($liveVer -eq $next)) {
    Set-LastKnownGood $next
    Lock-HarnessRelease $next
    Say "[6/6] Recorded last-known-good + locked release read-only." "DarkGray"
    Write-Host "----------------------------------------------------------" -ForegroundColor DarkGray
    Say ("[OK] {0} is LIVE on :{1} (bootId {2}). Last-known-good = {0}." -f $next, $PROD_PORT, $prodBoot) "Green"
    Say "     The browser will auto-reload onto the new version." "DarkGray"
    exit 0
}

# Could NOT confirm $next is the live version. What we do next depends ENTIRELY on who owns the process.
# RULE: never self-rollback while a supervisor is alive — it has its OWN crash-loop fallback to
# last-known-good, and a 2nd "rollback" restart racing its relaunch is the exact race that churned
# restarts (deploy-vN <-> rollback-vM) and wedged the supervisor. Trust it; just report.
if (Test-SupervisorFlag) {
    Lock-HarnessRelease $next
    Write-Host "----------------------------------------------------------" -ForegroundColor DarkGray
    if ($liveVer -and ($liveVer -ne $next)) {
        Say ("[!] {0} did not stay up; the supervisor is running {1} (its last-known-good fallback)." -f $next, $liveVer) "Yellow"
        Say "    Not rolling back (the supervisor owns the process). Fix dev and redeploy." "Yellow"
        exit 1
    }
    Say ("[!] {0} promoted, but not CONFIRMED live from here within 60s (the box may be busy)." -f $next) "Yellow"
    Say "    A supervisor owns the process: it will keep the new version up, or fall back to last-known-good if it boot-loops." "Yellow"
    Say "    NOT issuing a rollback (that race is what destabilised restarts). It records last-known-good after 30s healthy uptime." "DarkGray"
    exit 0
}

# NO supervisor: Switch-LiveVersion managed the process directly and it did not come up. Roll back ourselves.
Say "[!] New version did NOT come up (no supervisor running). Rolling back ..." "Yellow"
$fallback = $prev
if (-not $fallback) { $fallback = Get-LastKnownGood }
if ($fallback -and (Test-ReleaseExists $fallback)) {
    Set-CurrentVersion $fallback
    $rbBoot = Switch-LiveVersion -Version $fallback -Port $PROD_PORT -HarnessHome $HOME_DIR -Reason ("rollback-" + $fallback)
    if ($rbBoot) { Say ("[OK] Rolled back to {0}." -f $fallback) "Green" }
    else { Say ("[X] Rollback to {0} also failed. Manual rescue: run Start_Harness.ps1." -f $fallback) "Red" }
} else {
    Say "[X] No previous release to roll back to. Fix dev + redeploy." "Red"
}
exit 1
