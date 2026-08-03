@echo off
setlocal EnableDelayedExpansion

REM META Showroom - Start fuer Anwender (ohne Admin)
REM Startet Redis/Memurai, Pre-Flight, API + MCP + Vite Preview, oeffnet Browser.

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
cd /d "%ROOT%"

set "LOG_BASE=%LOCALAPPDATA%\meta-showroom\logs"
set "OUT_BASE=%LOCALAPPDATA%\meta-showroom\outputs"
if not exist "%LOG_BASE%" mkdir "%LOG_BASE%"
if not exist "%OUT_BASE%" mkdir "%OUT_BASE%"
set "LOG_DIR=%LOG_BASE%"
set "BLENDER_OUTPUT_DIR=%OUT_BASE%"

echo.
echo META Showroom wird gestartet...
echo Projekt: %ROOT%
echo Logs:    %LOG_BASE%
echo.

REM --- Memurai / Redis ---
sc query Memurai >nul 2>&1
if !errorlevel! equ 0 (
    for /f "tokens=3" %%s in ('sc query Memurai ^| findstr /i "STATE"') do set "MEM_STATE=%%s"
    if /i not "!MEM_STATE!"=="RUNNING" (
        echo Memurai-Dienst wird gestartet...
        net start Memurai >nul 2>&1
        if !errorlevel! neq 0 (
            echo WARNUNG: Memurai konnte nicht gestartet werden. Bitte IT kontaktieren.
        )
    )
)

REM --- Port-Check (3000, 5050, 8001) ---
call :check_port 3000 "API-Gateway"
if errorlevel 1 goto :port_fail
call :check_port 5050 "Showroom (Vite)"
if errorlevel 1 goto :port_fail
call :check_port 8001 "MCP-Server"
if errorlevel 1 goto :port_fail

REM --- Node vorhanden? ---
where node >nul 2>&1
if errorlevel 1 (
    echo FEHLER: Node.js nicht im PATH. IT-Installation erforderlich.
    pause
    exit /b 1
)

REM --- dist vorhanden? ---
if not exist "%ROOT%\dist\index.html" (
    echo FEHLER: dist\index.html fehlt. IT muss install-windows.ps1 ausfuehren.
    pause
    exit /b 1
)

REM --- Pre-Flight ---
echo Pre-Flight-Checks...
node scripts\start-services.mjs
if errorlevel 1 (
    echo.
    echo Pre-Flight fehlgeschlagen. Siehe Meldungen oben.
    pause
    exit /b 1
)

REM --- PID-Datei fuer stop-showroom.cmd ---
set "PID_FILE=%LOCALAPPDATA%\meta-showroom\showroom.pids"
if exist "%PID_FILE%" del /f /q "%PID_FILE%"

echo.
echo Dienste starten (API :3000, MCP :8001, Showroom :5050)...
echo Fenster minimiert lassen - zum Beenden "META Showroom stoppen" verwenden.
echo.

start "META Showroom Stack" /MIN cmd /c ^
  "cd /d \"%ROOT%\" && set LOG_DIR=%LOG_BASE% && set BLENDER_OUTPUT_DIR=%OUT_BASE% && ^
   npx concurrently -n mcp,api,vite -c blue,green,yellow ^
   \"npm run start:mcp\" \"npm run start:api\" \"npm run preview\" ^
   >> \"%LOG_BASE%\stack-%date:~-4%%date:~-7,2%%date:~-10,2%.log\" 2>&1"

REM Kurz warten bis Vite hoert
timeout /t 4 /nobreak >nul

REM --- Browser oeffnen ---
start "" "http://localhost:5050/"

echo Showroom laeuft: http://localhost:5050/
echo.
exit /b 0

:check_port
set "PORT=%~1"
set "LABEL=%~2"
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul 2>&1
if !errorlevel! equ 0 (
    echo FEHLER: Port %PORT% (%LABEL%) ist bereits belegt.
    echo        Schliesse andere Anwendungen oder starte den Rechner neu.
    exit /b 1
)
exit /b 0

:port_fail
pause
exit /b 1
