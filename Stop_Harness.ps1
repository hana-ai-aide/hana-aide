# Stop_Harness.ps1
# Stop production AND its supervisor. Sets the stop-flag (so the supervisor loop exits instead of
# relaunching), asks the server to exit gracefully, then makes sure nothing lingers on the port.

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\_harness-release-lib.ps1"

$PROD_PORT = if ($env:HARNESS_PORT) { [int]$env:HARNESS_PORT } else { 3300 }
function Say { param([string]$m, [string]$c = "Gray") Write-Host $m -ForegroundColor $c }

$hadSupervisor = Test-SupervisorFlag
Set-StopFlag

$up = Test-HarnessHealth -Port $PROD_PORT -TimeoutSec 2
if ($up) {
    # Graceful: server exits, the supervisor sees the stop-flag and breaks its loop (no relaunch).
    Request-HarnessRestart -Port $PROD_PORT -Reason "stop" | Out-Null
    Start-Sleep -Seconds 1
}
Stop-HarnessOnPort $PROD_PORT   # safety net (and the path when no supervisor was running)

# If nobody is looping, clear our own flag so a future direct launch isn't confused.
if (-not $hadSupervisor) { Clear-StopFlag }

Say ("[OK] Stopped harness on :{0}." -f $PROD_PORT) "Green"
