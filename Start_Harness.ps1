# Start_Harness.ps1
# The SUPERVISOR. Runs a forever-loop that OWNS the harness server process:
#   read current.json -> start that release -> wait for it to exit -> relaunch.
#
# Because this script keeps running even after the server it started exits, "restart" needs no human:
# the server just calls process.exit(0) (POST /api/restart) and this loop relaunches it, re-reading
# current.json so a freshly-deployed version goes live. If a version boot-crashes repeatedly, the
# loop automatically falls back to last-known-good (the "even launching fails" safety net).
#
# Keep this console open = production is up. Stop it with Stop_Harness.ps1.

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\_harness-release-lib.ps1"

$PROD_PORT = if ($env:HARNESS_PORT) { [int]$env:HARNESS_PORT } else { 3300 }
$HOME_DIR  = Get-HarnessRoot
if (-not $env:HARNESS_PROJECT_ROOT) { $env:HARNESS_PROJECT_ROOT = $HOME_DIR }

function Say { param([string]$m, [string]$c = "Gray") Write-Host $m -ForegroundColor $c }

try { Clear-Host } catch { }  # Clear-Host has no console handle when run as a background/detached job
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "     Harness Portal  (supervisor)" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan

try { $nv = node -v 2>$null; Say ("[OK] Node.js {0}" -f $nv) "Green" }
catch { Say "[X] Node.js not found. Install from https://nodejs.org" "Red"; Read-Host "Press Enter to exit"; exit 1 }

# Pre-flight: base install must have run (spec: specs/SPEC-setup.md sec 4). If deps or the
# global-knowledge skeleton are missing, DON'T half-start (the server would crash reading
# missing paths inside the supervisor loop). Point at ./install.ps1 and exit gracefully.
$missing = @()
if (-not (Test-Path (Join-Path $HOME_DIR "portal\node_modules"))) { $missing += "portal/node_modules" }
if (-not (Test-Path (Join-Path $HOME_DIR "global-knowledge")))    { $missing += "global-knowledge/" }
if ($missing.Count -gt 0) {
    Say ("[X] Base install incomplete — missing: {0}" -f ($missing -join ", ")) "Red"
    Say "    Please run the one-time base install first:" "Yellow"
    Say "        ./install.ps1" "Cyan"
    Read-Host "Press Enter to exit"
    exit 1
}

$url = "http://localhost:$PROD_PORT"

# Already running (e.g. a supervisor in another console)? Just open the browser.
$existing = Test-HarnessHealth -Port $PROD_PORT -TimeoutSec 2
if ($existing) {
    Say ("[i] A harness is already running on :{0} (bootId {1}). Opening browser." -f $PROD_PORT, $existing) "Yellow"
    Start-Process $url
    exit 0
}

# Bootstrap the first release from the dev tree if none exist.
$current = Get-CurrentVersion
if (-not $current -or -not (Test-ReleaseExists $current)) {
    Say "[*] No current release. Bootstrapping v1 from the dev tree ..." "Cyan"
    $v1 = Get-NextVersion
    New-HarnessSnapshot $v1 | Out-Null
    Set-CurrentVersion $v1
    Set-LastKnownGood $v1
    Say ("    created {0}" -f $v1) "DarkGray"
}

Clear-StopFlag
Set-SupervisorFlag

# Open the browser once, after the server first answers (runs alongside the blocking loop below).
if (-not $env:HARNESS_NO_BROWSER -and $null -ne (Get-Command Start-ThreadJob -ErrorAction SilentlyContinue)) {
    Start-ThreadJob -ScriptBlock {
        param($u, $port)
        for ($i = 0; $i -lt 40; $i++) {
            try { $r = Invoke-RestMethod -Uri ("http://localhost:{0}/api/ping" -f $port) -TimeoutSec 2; if ($r.bootId) { Start-Process $u; break } } catch { }
            Start-Sleep -Milliseconds 700
        }
    } -ArgumentList $url, $PROD_PORT | Out-Null
}

Say ("[*] Supervisor up. Production on {0}. Ctrl+C or Stop_Harness.ps1 to stop." -f $url) "Green"
Write-Host "----------------------------------------------------------" -ForegroundColor DarkGray

$quickExits = 0
try {
    while ($true) {
        if (Test-StopFlag) { Clear-StopFlag; Say "[*] Stop requested. Supervisor exiting." "Yellow"; break }

        # A SUPERVISOR must never die on a TRANSIENT error (current.json briefly locked while a deploy
        # promotes; a Get-NetTCPConnection / Stop-Process hiccup; etc.). With $ErrorActionPreference=Stop
        # any such throw would otherwise exit the whole loop. Wrap each iteration: log + keep looping.
        # Only stop.flag (Stop_Harness.ps1) ends the supervisor — surviving errors is its entire job.
        try {
        $current = Get-CurrentVersion
        if (-not (Test-ReleaseExists $current)) {
            $lkg = Get-LastKnownGood
            if ($lkg -and (Test-ReleaseExists $lkg)) { Say ("[!] {0} missing; using last-known-good {1}." -f $current, $lkg) "Yellow"; Set-CurrentVersion $lkg; $current = $lkg }
            else { Say "[X] No runnable release. Run Deploy_Harness.ps1. Supervisor exiting." "Red"; break }
        }

        # Before binding, make sure the port is actually free — on Windows a just-exited server (or an
        # orphaned CLI child) can hold :PORT for a moment, and binding too soon throws EADDRINUSE and
        # the new version crashes on boot → crash-loop → supervisor gives up. Clear + wait first.
        Stop-HarnessOnPort $PROD_PORT
        if (-not (Wait-PortFree -Port $PROD_PORT -TimeoutSec 15)) { Say ("[!] :{0} still busy after 15s; launching anyway." -f $PROD_PORT) "Yellow" }

        Say ("[*] Launching {0} on :{1} ..." -f $current, $PROD_PORT)
        $t0 = Get-Date
        Start-HarnessReleaseAndWait -Version $current -Port $PROD_PORT -HarnessHome $HOME_DIR | Out-Null
        $ran = ((Get-Date) - $t0).TotalSeconds

        if (Test-StopFlag) { Clear-StopFlag; Say "[*] Stopped." "Yellow"; break }

        if ($ran -lt 8) {
            $quickExits++
            Say ("[!] {0} exited after {1:N1}s (crash attempt {2})." -f $current, $ran, $quickExits) "Yellow"
            if ($quickExits -ge 2) {
                $lkg = Get-LastKnownGood
                if ($lkg -and ($lkg -ne $current) -and (Test-ReleaseExists $lkg)) {
                    Say ("[*] Boot-loop -> falling back to last-known-good {0}." -f $lkg) "Cyan"
                    Set-CurrentVersion $lkg
                    $quickExits = 0
                } else {
                    Say ("[X] {0} keeps crashing and no good fallback. Fix dev + redeploy. Supervisor exiting." -f $current) "Red"
                    break
                }
            }
        } else {
            $quickExits = 0
            Say ("[*] Server exited (restart requested) -> relaunching {0}." -f (Get-CurrentVersion)) "DarkGray"
        }
        } catch {
            # Transient error this iteration → DON'T die. Log it, breathe, and loop again (relaunch).
            Say ("[!] 監督者迴圈遇到非預期錯誤，已記錄並繼續（不退出）：{0}" -f $_.Exception.Message) "Yellow"
            Start-Sleep -Seconds 2
        }
    }
} finally {
    Clear-SupervisorFlag
}
