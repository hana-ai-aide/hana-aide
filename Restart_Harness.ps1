# Restart_Harness.ps1
# Ask the running server to restart gracefully. Needs the supervisor (Start_Harness.ps1) to be
# running: the server exits and the supervisor relaunches it on whatever current.json points at.
# This is what a self-heal/deploy uses under the hood, exposed for manual use.

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\_harness-release-lib.ps1"

$PROD_PORT = if ($env:HARNESS_PORT) { [int]$env:HARNESS_PORT } else { 3300 }
function Say { param([string]$m, [string]$c = "Gray") Write-Host $m -ForegroundColor $c }

if (-not (Test-SupervisorFlag)) {
    Say "[X] No supervisor is running. A graceful restart needs Start_Harness.ps1's supervisor loop" "Red"
    Say "    (otherwise the server would exit and nothing would bring it back). Aborting." "Red"
    exit 1
}

$old = Test-HarnessHealth -Port $PROD_PORT -TimeoutSec 2
if (-not $old) { Say ("[X] Nothing healthy on :{0} to restart." -f $PROD_PORT) "Red"; exit 1 }

Say ("[*] Requesting graceful restart on :{0} (current bootId {1}) ..." -f $PROD_PORT, $old) "Cyan"
if (-not (Request-HarnessRestart -Port $PROD_PORT -Reason "manual")) {
    Say "[X] Server did not accept the restart request." "Red"; exit 1
}

$nb = Wait-HarnessRestarted -Port $PROD_PORT -OldBootId $old -TimeoutSec 30
if ($nb) {
    Say ("[OK] Restarted. New bootId {0}. The browser will auto-reload + show a restart notice." -f $nb) "Green"
    exit 0
} else {
    Say "[X] Server did not come back within 30s. Check the supervisor console." "Red"
    exit 1
}
