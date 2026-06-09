# META Showroom – IT-Installation (Windows, voller Stack)
# Aufruf (Admin empfohlen):
#   powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1 -Unattended
#   powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1 -Update -Unattended

param(
    [switch]$Unattended,
    [switch]$Update,
    [string]$InstallRoot = "",
    [string]$BlenderConverterPath = "",
    [string]$BlenderPath = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
if ($InstallRoot) { $ProjectRoot = $InstallRoot.TrimEnd('\') }

function Write-Step { param($msg) Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok { param($msg) Write-Host "  OK: $msg" -ForegroundColor Green }
function Write-Warn { param($msg) Write-Host "  WARN: $msg" -ForegroundColor Yellow }
function Write-Err { param($msg) Write-Host "  FEHLER: $msg" -ForegroundColor Red }

function Test-NodeVersion {
    try {
        $nodeVersion = node -v 2>$null
        if (-not $nodeVersion) { throw "node nicht gefunden" }
        $nodeMajor = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
        $nodeMinor = [int]($nodeVersion -replace 'v\d+\.(\d+)\..*', '$1')
        if ($nodeMajor -lt 20 -or ($nodeMajor -eq 20 -and $nodeMinor -lt 11)) {
            Write-Err "Node.js 20.11+ erforderlich. Aktuell: $nodeVersion"
            return $false
        }
        Write-Ok "Node.js $nodeVersion"
        return $true
    } catch {
        Write-Err "Node.js nicht gefunden. Installiere von https://nodejs.org/"
        return $false
    }
}

function Test-PythonVersion {
    try {
        $pyVersion = python --version 2>&1
        if (-not ($pyVersion -match 'Python (\d+)\.(\d+)')) { throw "Python nicht gefunden" }
        $pyMajor = [int]$Matches[1]
        $pyMinor = [int]$Matches[2]
        if ($pyMajor -lt 3 -or ($pyMajor -eq 3 -and $pyMinor -lt 10)) {
            Write-Err "Python 3.10+ erforderlich. Aktuell: $pyVersion"
            return $false
        }
        Write-Ok "Python $pyVersion"
        return $true
    } catch {
        Write-Err "Python nicht gefunden. Installiere von https://www.python.org/downloads/"
        return $false
    }
}

function Find-BlenderExe {
    param([string]$ExplicitPath)
    if ($ExplicitPath -and (Test-Path $ExplicitPath)) {
        return (Resolve-Path $ExplicitPath).Path
    }
    $envPath = [Environment]::GetEnvironmentVariable("BLENDER_PATH", "Machine")
    if (-not $envPath) { $envPath = [Environment]::GetEnvironmentVariable("BLENDER_PATH", "User") }
    if ($envPath -and (Test-Path $envPath)) { return $envPath }

    $roots = @(
        "${env:ProgramFiles}\Blender Foundation",
        "${env:ProgramFiles(x86)}\Blender Foundation"
    )
    foreach ($root in $roots) {
        if (-not (Test-Path $root)) { continue }
        $found = Get-ChildItem -Path $root -Filter "blender.exe" -Recurse -ErrorAction SilentlyContinue |
            Sort-Object { $_.DirectoryName } -Descending |
            Select-Object -First 1
        if ($found) { return $found.FullName }
    }
    return $null
}

function Set-BlenderPathEnv {
    param([string]$BlenderExe)
    if (-not $BlenderExe) {
        Write-Warn "Blender nicht gefunden. Setze BLENDER_PATH manuell oder installiere Blender 4.x."
        return
    }
    Write-Ok "Blender: $BlenderExe"
    [Environment]::SetEnvironmentVariable("BLENDER_PATH", $BlenderExe, "Machine")
    $env:BLENDER_PATH = $BlenderExe
}

function Test-MemuraiService {
    $svc = Get-Service -Name "Memurai" -ErrorAction SilentlyContinue
    if ($svc) {
        if ($svc.Status -ne "Running") {
            try {
                Start-Service -Name "Memurai" -ErrorAction Stop
                Write-Ok "Memurai-Dienst gestartet"
            } catch {
                Write-Warn "Memurai installiert, Start fehlgeschlagen: $_"
                Write-Host "  IT: Dienst starten und ggf. Start-Recht fuer User setzen (siehe docs/windows-it-rollout.md)"
            }
        } else {
            Write-Ok "Memurai-Dienst laeuft"
        }
        return $true
    }

    # Fallback: redis-cli direkt
    try {
        $r = redis-cli ping 2>&1
        if ($r -match 'PONG') {
            Write-Ok "Redis (redis-cli): OK"
            return $true
        }
    } catch {}

    Write-Warn "Memurai/Redis nicht erreichbar. Installiere Memurai Developer Edition (https://www.memurai.com/)"
    return $false
}

function Ensure-BlenderExporter {
    param([string]$ExternalPath)
    $converterPath = Join-Path $ProjectRoot "blender-exporter"
    if (Test-Path $converterPath) {
        Write-Ok "blender-exporter existiert bereits"
        return $true
    }
    if (-not $ExternalPath) {
        if ($Unattended) {
            Write-Err "blender-exporter fehlt und kein -BlenderConverterPath angegeben."
            return $false
        }
        Write-Host "  Pfad zum Blender-Converter (z. B. D:\META Apps\GLB export Blender):"
        $ExternalPath = (Read-Host "  ").Trim()
    }
    if (-not $ExternalPath -or -not (Test-Path $ExternalPath)) {
        Write-Err "Blender-Converter-Pfad ungueltig: $ExternalPath"
        return $false
    }
    $target = (Resolve-Path $ExternalPath).Path
    try {
        cmd /c mklink /J "$converterPath" "$target"
        if ($LASTEXITCODE -ne 0) { throw "mklink Exit $LASTEXITCODE" }
        Write-Ok "Junction erstellt: blender-exporter -> $target"
        return $true
    } catch {
        Write-Err "Junction fehlgeschlagen: $_"
        Write-Host "  Alternative: blender-exporter als Unterordner ins Paket legen (empfohlen fuer IT-Rollout)."
        return $false
    }
}

function Ensure-UserDataDirs {
    $base = Join-Path $env:LOCALAPPDATA "meta-showroom"
    foreach ($sub in @("logs", "outputs")) {
        $p = Join-Path $base $sub
        if (-not (Test-Path $p)) {
            New-Item -ItemType Directory -Path $p -Force | Out-Null
        }
    }
    [Environment]::SetEnvironmentVariable("BLENDER_OUTPUT_DIR", (Join-Path $base "outputs"), "User")
    [Environment]::SetEnvironmentVariable("LOG_DIR", (Join-Path $base "logs"), "User")
    Write-Ok "User-Daten: $base"
}

function New-DesktopShortcut {
    param(
        [string]$Name,
        [string]$TargetPath,
        [string]$Arguments = "",
        [string]$WorkingDirectory = $ProjectRoot
    )
    $shell = New-Object -ComObject WScript.Shell
    $desktop = [Environment]::GetFolderPath("Desktop")
    $lnk = Join-Path $desktop "$Name.lnk"
    $sc = $shell.CreateShortcut($lnk)
    $sc.TargetPath = $TargetPath
    if ($Arguments) { $sc.Arguments = $Arguments }
    $sc.WorkingDirectory = $WorkingDirectory
    $sc.Save()
    Write-Ok "Verknuepfung: $lnk"
}

function Install-Shortcuts {
    $startCmd = Join-Path $ProjectRoot "start-showroom.cmd"
    $stopCmd = Join-Path $ProjectRoot "stop-showroom.cmd"
    if (-not (Test-Path $startCmd)) {
        Write-Warn "start-showroom.cmd fehlt – Verknuepfungen uebersprungen"
        return
    }
    New-DesktopShortcut -Name "META Showroom" -TargetPath $startCmd
    if (Test-Path $stopCmd) {
        New-DesktopShortcut -Name "META Showroom stoppen" -TargetPath $stopCmd
    }
    $startMenu = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs"
    if (Test-Path $startMenu) {
        $menuDir = Join-Path $startMenu "META Showroom"
        if (-not (Test-Path $menuDir)) { New-Item -ItemType Directory -Path $menuDir | Out-Null }
        $shell = New-Object -ComObject WScript.Shell
        foreach ($pair in @(
            @{ Name = "META Showroom"; Path = $startCmd },
            @{ Name = "META Showroom stoppen"; Path = $stopCmd }
        )) {
            if (-not (Test-Path $pair.Path)) { continue }
            $sc = $shell.CreateShortcut((Join-Path $menuDir "$($pair.Name).lnk"))
            $sc.TargetPath = $pair.Path
            $sc.WorkingDirectory = $ProjectRoot
            $sc.Save()
        }
        Write-Ok "Startmenue: $menuDir"
    }
}

# --- Hauptablauf ---
Write-Host ""
Write-Host "META Showroom – IT-Installation" -ForegroundColor White
Write-Host "Projektroot: $ProjectRoot" -ForegroundColor Gray
if ($Update) { Write-Host "Modus: Update (venv wird neu aufgebaut falls noetig)" -ForegroundColor Gray }
Write-Host ""

Write-Step "Voraussetzungen pruefen"
if (-not (Test-NodeVersion)) { exit 1 }
if (-not (Test-PythonVersion)) { exit 1 }
Test-MemuraiService | Out-Null

Write-Step "Blender"
$blenderExe = Find-BlenderExe -ExplicitPath $BlenderPath
Set-BlenderPathEnv -BlenderExe $blenderExe

Write-Step "Blender-Converter Verzeichnis"
if (-not (Ensure-BlenderExporter -ExternalPath $BlenderConverterPath)) { exit 1 }

Write-Step "User-Datenverzeichnisse"
Ensure-UserDataDirs

if (-not $Update) {
    Write-Step "Showroom Dependencies"
    Set-Location $ProjectRoot
    npm install
    if ($LASTEXITCODE -ne 0) { Write-Err "npm install fehlgeschlagen"; exit 1 }
    Write-Ok "Showroom node_modules"
}

$apiGatewayPath = Join-Path $ProjectRoot "blender-exporter\blender-mcp-converter\api-gateway"
if (Test-Path $apiGatewayPath) {
    Write-Step "API Gateway Dependencies"
    Set-Location $apiGatewayPath
    npm install
    if ($LASTEXITCODE -ne 0) { Write-Warn "API Gateway npm install fehlgeschlagen" }
    else { Write-Ok "API Gateway node_modules" }
} else {
    Write-Warn "API Gateway nicht gefunden. Ueberspringe."
}

$mcpDir = Join-Path $ProjectRoot "blender-exporter\blender-mcp-converter\mcp-server"
$venvPython = Join-Path $mcpDir "venv\Scripts\python.exe"
if (Test-Path $mcpDir) {
    Write-Step "MCP Server (Python venv)"
    if ($Update -and (Test-Path (Join-Path $mcpDir "venv"))) {
        Remove-Item -Recurse -Force (Join-Path $mcpDir "venv")
        Write-Ok "Altes venv entfernt (Update)"
    }
    if (-not (Test-Path $venvPython)) {
        Set-Location $mcpDir
        python -m venv venv
        if ($LASTEXITCODE -ne 0) { Write-Err "venv Erstellung fehlgeschlagen"; exit 1 }
        Write-Ok "venv erstellt"
    } else {
        Write-Ok "venv existiert bereits"
    }
    Set-Location $mcpDir
    & $venvPython -m pip install -r requirements.txt --quiet
    if ($LASTEXITCODE -ne 0) { Write-Warn "pip install fehlgeschlagen" }
    else { Write-Ok "MCP Dependencies" }
} else {
    Write-Warn "MCP-Server nicht gefunden. Ueberspringe."
}

Write-Step "Production-Build pruefen"
Set-Location $ProjectRoot
if (-not (Test-Path (Join-Path $ProjectRoot "dist\index.html"))) {
    Write-Host "  dist/ fehlt – fuehre npm run build aus..."
    npm run build
    if ($LASTEXITCODE -ne 0) { Write-Err "npm run build fehlgeschlagen"; exit 1 }
    Write-Ok "dist/ erstellt"
} else {
    Write-Ok "dist/ vorhanden"
}

Write-Step "Pre-Flight"
node scripts/start-services.mjs
if ($LASTEXITCODE -ne 0) {
    Write-Warn "Pre-Flight mit Warnungen/Fehlern – siehe Ausgabe oben"
}

Write-Step "Verknuepfungen"
Install-Shortcuts

Set-Location $ProjectRoot
Write-Host ""
Write-Host "Installation abgeschlossen." -ForegroundColor Green
Write-Host "Anwender starten mit: start-showroom.cmd (Desktop-Verknuepfung)" -ForegroundColor Cyan
Write-Host "IT-Doku: docs\windows-it-rollout.md" -ForegroundColor Gray
Write-Host ""
