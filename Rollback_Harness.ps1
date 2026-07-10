# Rollback_Harness.ps1
# Point production back at an earlier release and restart it.
#
#   .\Rollback_Harness.ps1            -> roll back to last-known-good
#   .\Rollback_Harness.ps1 v3         -> roll back to a specific version
#   .\Rollback_Harness.ps1 -List      -> just list available releases and exit
#
# This never edits release code; it only moves the current.json pointer and restarts.

param(
    [string]$Version,
    [switch]$List
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\_harness-release-lib.ps1"

$PROD_PORT = if ($env:HARNESS_PORT) { [int]$env:HARNESS_PORT } else { 3300 }
$HOME_DIR  = Get-HarnessRoot

function Say { param([string]$m, [string]$c = "Gray") Write-Host $m -ForegroundColor $c }

$all = Get-AllReleaseVersions
$current = Get-CurrentVersion
$lkg = Get-LastKnownGood

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "     Harness Rollback" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
Say ("  Releases : {0}" -f $(if ($all.Count) { ($all -join ", ") } else { "(none)" }))
Say ("  Current  : {0}" -f $(if ($current) { $current } else { "(none)" }))
Say ("  L-K-Good : {0}" -f $(if ($lkg) { $lkg } else { "(none)" }))
Write-Host "----------------------------------------------------------" -ForegroundColor DarkGray

if ($List) { exit 0 }
if ($all.Count -eq 0) { Say "[X] No releases to roll back to." "Red"; exit 1 }

$target = $Version
if (-not $target) { $target = $lkg }
if (-not $target) { Say "[X] No target given and no last-known-good recorded." "Red"; exit 1 }
if (-not (Test-ReleaseExists $target)) { Say ("[X] Release {0} does not exist." -f $target) "Red"; exit 1 }

Say ("[*] Rolling production back to {0} on :{1} ..." -f $target, $PROD_PORT) "Cyan"
Set-CurrentVersion $target
$boot = Switch-LiveVersion -Version $target -Port $PROD_PORT -HarnessHome $HOME_DIR -Reason ("rollback-" + $target)

if ($boot) {
    Say ("[OK] {0} is live on :{1} (bootId {2}). The browser will auto-reload." -f $target, $PROD_PORT, $boot) "Green"
    exit 0
} else {
    Say ("[X] {0} did not come up healthy. Try another version: .\Rollback_Harness.ps1 -List" -f $target) "Red"
    exit 1
}
