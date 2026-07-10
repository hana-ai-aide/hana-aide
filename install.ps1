# install.ps1
# ONE-TIME base install for a fresh clone. Deterministic, IDEMPOTENT (safe to re-run),
# PowerShell 5.1 compatible (no ?? / ?. / ?: / && / ||).
#
# What it does (spec: specs/SPEC-setup.md sec 3):
#   1. Verify Node.js >= 22 (server uses node:sqlite experimental feature).
#   2. npm install under portal/ (node-pty is native; if it fails -> point at VS Build Tools).
#   3. Create the global-knowledge/ skeleton dirs the server reads on boot.
#   4. Print a summary and point to /setup (inside Hana) for optional capabilities.
#
# What it does NOT do (that is /setup's advisory job): install .venv / playwright / drivers,
# or write any global-knowledge CONTENT. This only makes "clone -> run" work on a new machine.

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

function Say { param([string]$m, [string]$c = "Gray") Write-Host $m -ForegroundColor $c }

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "     Harness base install" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan

# --- Step 1: Node.js >= 22 -------------------------------------------------
$nodeVer = $null
try { $nodeVer = (node -v 2>$null) } catch { $nodeVer = $null }
if (-not $nodeVer) {
    Say "[X] Node.js not found on PATH." "Red"
    Say "    Install Node.js 22 or newer from https://nodejs.org then re-run ./install.ps1" "Yellow"
    exit 1
}
$major = 0
$m = [regex]::Match($nodeVer, 'v(\d+)')
if ($m.Success) { $major = [int]$m.Groups[1].Value }
if ($major -lt 22) {
    Say ("[X] Node.js {0} is too old. Harness needs 22+ (uses node:sqlite)." -f $nodeVer) "Red"
    Say "    Upgrade from https://nodejs.org then re-run ./install.ps1" "Yellow"
    exit 1
}
Say ("[OK] Node.js {0}" -f $nodeVer) "Green"

# --- Step 2: npm install under portal/ -------------------------------------
$portal = Join-Path $root "portal"
if (-not (Test-Path (Join-Path $portal "package.json"))) {
    Say ("[X] portal/package.json not found at {0}. Is this the harness root?" -f $portal) "Red"
    exit 1
}
Say "[*] Installing portal dependencies (npm install) ..." "Cyan"
Push-Location $portal
try {
    npm install
    $npmExit = $LASTEXITCODE
} finally {
    Pop-Location
}
if ($npmExit -ne 0) {
    Say ""
    Say "[X] npm install failed." "Red"
    Say "    The most common cause is node-pty: it is a NATIVE module that must compile." "Yellow"
    Say "    Usually a prebuilt binary is used and this just works; when it does not, you need" "Yellow"
    Say "    the Windows C++ build toolchain:" "Yellow"
    Say "      - Install 'Visual Studio Build Tools' with the 'Desktop development with C++' workload:" "Yellow"
    Say "        https://visualstudio.microsoft.com/visual-cpp-build-tools/" "Cyan"
    Say "      - Then open a NEW console and re-run ./install.ps1" "Yellow"
    exit 1
}
Say "[OK] portal dependencies installed." "Green"

# --- Step 3: global-knowledge/ skeleton ------------------------------------
# The server reads these paths on boot; create the empty skeleton (idempotent).
# We do NOT write any content here (memory/policy defaults are out of scope this version).
$gk = Join-Path $root "global-knowledge"
$skeleton = @("secrets", "telegram", "commands", "knowledge")
foreach ($sub in $skeleton) {
    $p = Join-Path $gk $sub
    if (-not (Test-Path $p)) {
        New-Item -ItemType Directory -Force -Path $p | Out-Null
        Say ("    created global-knowledge/{0}/" -f $sub) "DarkGray"
    } else {
        Say ("    ok      global-knowledge/{0}/" -f $sub) "DarkGray"
    }
}
Say "[OK] global-knowledge/ skeleton ready." "Green"

# --- Step 4: summary --------------------------------------------------------
Write-Host ""
Write-Host "----------------------------------------------------------" -ForegroundColor DarkGray
Say "Base install complete." "Green"
Write-Host ""
Say "Next steps:" "White"
Say "  1. Start the portal:   ./Start_Harness.ps1" "White"
Say "  2. Open the browser:   http://localhost:3300/" "White"
Say "  3. Inside Hana, run:   /setup" "White"
Say "       -> a guided checklist for OPTIONAL capabilities (AI CLI login," "Gray"
Say "          presentation export, speech-to-text, GPU, Telegram, remote access, ...)." "Gray"
Write-Host ""
Say "Note: to chat with Hana you still need at least one AI CLI installed and logged in" "Gray"
Say "      (claude / codex / Antigravity agy). /setup will detect and guide that." "Gray"
Write-Host "----------------------------------------------------------" -ForegroundColor DarkGray
exit 0
