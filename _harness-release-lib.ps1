# _harness-release-lib.ps1
# Shared helpers for the self-heal release system (immutable versioned releases + rollback).
# Dot-source from a sibling script:  . "$PSScriptRoot\_harness-release-lib.ps1"
#
# Layout (all under the harness root = this file's directory):
#   portal/ docgraph/            <- DEV working copy (Hana edits here)
#   portal/node_modules/         <- shared deps (node-pty); releases borrow these via NODE_PATH
#   .releases/v1 v2 ...          <- immutable code snapshots (portal/ + docgraph/, no node_modules)
#   .releases/current.json       <- { "version": "vN" }  the version production runs
#   .releases/last-known-good.json <- { "version": "vN" } the last version that passed a health check
#
# A release shares the dev tree's data (global-knowledge, registry) via HARNESS_HOME=<root>
# and the dev tree's deps via NODE_PATH=<root>\portal\node_modules. Only SOURCE is versioned.

$script:HarnessRoot = $PSScriptRoot

function Get-HarnessRoot { return $script:HarnessRoot }
function Get-ReleasesDir { return (Join-Path $script:HarnessRoot ".releases") }
function Get-SharedNodePath { return (Join-Path $script:HarnessRoot "portal\node_modules") }

function Ensure-ReleasesDir {
    $d = Get-ReleasesDir
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
    return $d
}

function Read-VersionPointer {
    param([string]$FileName)
    $p = Join-Path (Get-ReleasesDir) $FileName
    if (-not (Test-Path $p)) { return $null }
    try {
        $j = Get-Content -Raw -Path $p | ConvertFrom-Json
        return $j.version
    } catch { return $null }
}

function Write-VersionPointer {
    param([string]$FileName, [string]$Version)
    Ensure-ReleasesDir | Out-Null
    $p = Join-Path (Get-ReleasesDir) $FileName
    $obj = [ordered]@{ version = $Version; updatedAt = (Get-Date).ToString("o") }
    ($obj | ConvertTo-Json) | Set-Content -Path $p -Encoding UTF8
}

function Get-CurrentVersion { return (Read-VersionPointer "current.json") }
function Set-CurrentVersion { param([string]$Version) Write-VersionPointer "current.json" $Version }
function Get-LastKnownGood { return (Read-VersionPointer "last-known-good.json") }
function Set-LastKnownGood { param([string]$Version) Write-VersionPointer "last-known-good.json" $Version }

function Get-AllReleaseVersions {
    $d = Get-ReleasesDir
    if (-not (Test-Path $d)) { return @() }
    $dirs = Get-ChildItem -Path $d -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^v\d+$' }
    $sorted = $dirs | Sort-Object { [int]($_.Name.Substring(1)) }
    return @($sorted | ForEach-Object { $_.Name })
}

function Get-NextVersion {
    $all = Get-AllReleaseVersions
    if ($all.Count -eq 0) { return "v1" }
    $max = 0
    foreach ($v in $all) { $n = [int]($v.Substring(1)); if ($n -gt $max) { $max = $n } }
    return ("v{0}" -f ($max + 1))
}

function Test-ReleaseExists {
    param([string]$Version)
    $server = Join-Path (Join-Path (Get-ReleasesDir) $Version) "portal\server.js"
    return (Test-Path $server)
}

# Copy the DEV source (portal/ + docgraph/, excluding node_modules) into .releases\<Version>.
function New-HarnessSnapshot {
    param([string]$Version)
    $dest = Join-Path (Ensure-ReleasesDir) $Version
    if (Test-Path $dest) { throw "Release $Version already exists at $dest" }
    foreach ($sub in @("portal", "docgraph")) {
        $src = Join-Path $script:HarnessRoot $sub
        $dst = Join-Path $dest $sub
        New-Item -ItemType Directory -Force -Path $dst | Out-Null
        robocopy $src $dst /E /XD node_modules /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($sub, exit $LASTEXITCODE)" }
    }
    return $dest
}

# Mark every file in a release read-only (immutability signal + accidental-overwrite guard).
function Lock-HarnessRelease {
    param([string]$Version)
    $dir = Join-Path (Get-ReleasesDir) $Version
    if (-not (Test-Path $dir)) { return }
    Get-ChildItem -Path $dir -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
        try { $_.IsReadOnly = $true } catch { }
    }
}

# Run node with HARNESS_HOME/PORT/NODE_PATH set ONLY for the child (the child inherits the env at
# spawn time; we restore the parent's values right after so chained scripts in one process don't
# inherit a stale port — e.g. the smoke port leaking into a later step).
function Start-HarnessNode {
    param([string]$ServerPath, [int]$Port, [string]$HarnessHome, [hashtable]$StartArgs)
    $oldHome = $env:HARNESS_HOME; $oldPort = $env:HARNESS_PORT; $oldNodePath = $env:NODE_PATH
    try {
        $env:HARNESS_HOME = $HarnessHome
        $env:HARNESS_PORT = "$Port"
        $env:NODE_PATH = Get-SharedNodePath
        $base = @{ FilePath = "node"; ArgumentList = @("--experimental-sqlite", "--no-warnings", $ServerPath); PassThru = $true }
        foreach ($k in $StartArgs.Keys) { $base[$k] = $StartArgs[$k] }
        return (Start-Process @base)
    } finally {
        $env:HARNESS_HOME = $oldHome; $env:HARNESS_PORT = $oldPort; $env:NODE_PATH = $oldNodePath
    }
}

# Start a release as a DETACHED background node process. Returns the Process object.
function Start-HarnessRelease {
    param([string]$Version, [int]$Port, [string]$HarnessHome)
    $server = Join-Path (Join-Path (Get-ReleasesDir) $Version) "portal\server.js"
    if (-not (Test-Path $server)) { throw "Release server not found: $server" }
    return (Start-HarnessNode -ServerPath $server -Port $Port -HarnessHome $HarnessHome -StartArgs @{ WindowStyle = "Hidden" })
}

# Poll GET /api/ping until it answers (return the bootId) or the timeout elapses (return $null).
function Test-HarnessHealth {
    param([int]$Port, [int]$TimeoutSec = 20)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-RestMethod -Uri ("http://localhost:{0}/api/ping" -f $Port) -TimeoutSec 3
            if ($r.bootId) { return $r.bootId }
        } catch { Start-Sleep -Milliseconds 700 }
    }
    return $null
}

# Wait until nothing is LISTENING on a port (return $true), or timeout (return $false). Used before a
# relaunch: on Windows the OS can hold a just-closed listening socket briefly (or an orphaned child
# keeps it), so binding too soon throws EADDRINUSE and the new server crashes on boot.
function Wait-PortFree {
    param([int]$Port, [int]$TimeoutSec = 15)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (-not (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)) { return $true }
        Start-Sleep -Milliseconds 300
    }
    return $false
}

# Kill whatever is listening on a TCP port (used to stop the running production server).
function Stop-HarnessOnPort {
    param([int]$Port)
    try {
        $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop
        foreach ($c in $conns) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Milliseconds 600
    } catch { }
}

# --- Supervisor model -------------------------------------------------------------------------
# Start_Harness.ps1 runs a forever-loop that OWNS the server process: start -> wait -> on exit,
# relaunch (re-reading current.json, so a deploy's new version is picked up). "Restart" is then just
# the server calling process.exit(0); the still-running supervisor revives it. Two flag files
# coordinate this: stop.flag (tells the loop to exit instead of relaunch) and supervisor.flag (tells
# Deploy/Rollback a supervisor is alive, so they ask for a restart instead of spawning their own).

function Get-StopFlagPath { return (Join-Path (Get-ReleasesDir) "stop.flag") }
function Set-StopFlag { Ensure-ReleasesDir | Out-Null; Set-Content -Path (Get-StopFlagPath) -Value (Get-Date).ToString("o") }
function Clear-StopFlag { $p = Get-StopFlagPath; if (Test-Path $p) { Remove-Item -Force $p -ErrorAction SilentlyContinue } }
function Test-StopFlag { return (Test-Path (Get-StopFlagPath)) }

function Get-SupervisorFlagPath { return (Join-Path (Get-ReleasesDir) "supervisor.flag") }
function Set-SupervisorFlag { Ensure-ReleasesDir | Out-Null; Set-Content -Path (Get-SupervisorFlagPath) -Value ("{0}" -f $PID) }
function Clear-SupervisorFlag { $p = Get-SupervisorFlagPath; if (Test-Path $p) { Remove-Item -Force $p -ErrorAction SilentlyContinue } }
# A supervisor is "present" only if the flag's PID is ALIVE and is a PowerShell process. A flag left
# behind by a crashed/Ctrl+C'd supervisor is STALE — if we trusted it, a deploy would tell the server
# to gracefully exit "the supervisor will revive me" when nobody will, and the server stays dead.
function Test-SupervisorFlag {
    $p = Get-SupervisorFlagPath
    if (-not (Test-Path $p)) { return $false }
    $pidText = $null
    try { $pidText = (Get-Content -Path $p -Raw -ErrorAction Stop).Trim() } catch { }
    $supPid = 0
    if (-not [int]::TryParse($pidText, [ref]$supPid) -or $supPid -le 0) { Clear-SupervisorFlag; return $false }
    $proc = Get-Process -Id $supPid -ErrorAction SilentlyContinue
    if (-not $proc) { Clear-SupervisorFlag; return $false }                       # PID dead → stale
    if ($proc.ProcessName -notmatch 'pwsh|powershell') { Clear-SupervisorFlag; return $false }  # PID reused
    return $true
}

# Start a release in the FOREGROUND and block until it exits; return the exited Process (.ExitCode).
# Used by the supervisor loop. Logs stream to the supervisor console (-NoNewWindow).
function Start-HarnessReleaseAndWait {
    param([string]$Version, [int]$Port, [string]$HarnessHome)
    $server = Join-Path (Join-Path (Get-ReleasesDir) $Version) "portal\server.js"
    if (-not (Test-Path $server)) { throw "Release server not found: $server" }
    return (Start-HarnessNode -ServerPath $server -Port $Port -HarnessHome $HarnessHome -StartArgs @{ NoNewWindow = $true; Wait = $true })
}

# Ask the running server to exit gracefully (POST /api/restart). The supervisor relaunches it.
# Returns the parsed response ({ ok, bootId, deferred, runningJobs }) or $null if the POST failed.
# `deferred` = true means a job is still running; the server will restart only AFTER it finishes +
# saves, so the caller must NOT wait for a new bootId here (it would deadlock if the caller IS that job).
function Request-HarnessRestart {
    param([int]$Port, [string]$Reason = "deploy")
    try {
        $u = "http://localhost:{0}/api/restart?reason={1}" -f $Port, [uri]::EscapeDataString($Reason)
        return (Invoke-RestMethod -Method Post -Uri $u -TimeoutSec 5)
    } catch { return $null }
}

# Poll /api/ping until the bootId differs from $OldBootId (the restart took effect). Returns the new
# bootId, or $null on timeout. ($OldBootId may be $null when the server was down — any boot counts.)
function Wait-HarnessRestarted {
    # 90s default: a real-data boot under load (e.g. right after heavy agy chats, or scaffolding a
    # large active workspace) can take well over 30s; too short a wait makes a deploy falsely declare
    # failure and trigger a rollback that then collides with the still-booting new version.
    param([int]$Port, [string]$OldBootId, [int]$TimeoutSec = 90)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-RestMethod -Uri ("http://localhost:{0}/api/ping" -f $Port) -TimeoutSec 3
            if ($r.bootId -and ($r.bootId -ne $OldBootId)) { return $r.bootId }
        } catch { }
        Start-Sleep -Milliseconds 600
    }
    return $null
}

# Make $Version live on $Port. current.json must ALREADY point at $Version. If a supervisor owns the
# process, ask for a graceful restart and wait for the new boot; otherwise manage the process
# directly. Returns the new bootId on success, or $null. This is the one path Deploy + Rollback share.
# Returns: the new bootId (string) on a verified live switch; the literal "DEFERRED" if the restart
# was queued behind a running job (will go live after that turn ends — caller can't verify now); or
# $null on failure.
function Switch-LiveVersion {
    param([string]$Version, [int]$Port, [string]$HarnessHome, [string]$Reason = "switch")
    $old = $null
    try { $old = (Invoke-RestMethod -Uri ("http://localhost:{0}/api/ping" -f $Port) -TimeoutSec 2).bootId } catch { }
    if (Test-SupervisorFlag) {
        # A supervisor OWNS the process. Just SIGNAL a restart — it relaunches current.json and has its
        # OWN crash-loop fallback to last-known-good. We do NOT poll-and-rollback here: that race (Deploy
        # firing a 2nd "rollback" restart while the supervisor is still mid-relaunch) churned the two
        # against each other until the supervisor's crash-loop guard gave up and exited. So in supervisor
        # mode we NEVER return $null — we return the new bootId if we see it, else "STAGED" (trust it).
        $resp = Request-HarnessRestart -Port $Port -Reason $Reason
        if ($null -ne $resp -and $resp.deferred) { return "DEFERRED" }   # restart queued behind a live turn
        if ($null -eq $resp) { Stop-HarnessOnPort $Port }               # server not answering → free the port so the loop relaunches
        $nb = Wait-HarnessRestarted -Port $Port -OldBootId $old -TimeoutSec 90   # poll only to REPORT
        if ($nb) { return $nb }
        return "STAGED"
    }
    # No supervisor: we own the process directly.
    Stop-HarnessOnPort $Port
    Wait-PortFree -Port $Port -TimeoutSec 15 | Out-Null
    Start-HarnessRelease -Version $Version -Port $Port -HarnessHome $HarnessHome | Out-Null
    return (Test-HarnessHealth -Port $Port -TimeoutSec 25)
}
