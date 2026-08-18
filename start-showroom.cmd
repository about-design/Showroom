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

REM --- Node.js: portable Fallback (wenn nicht im PATH) ---
set "NODE_PORTABLE=%LOCALAPPDATA%\nodejs\node-v20.20.2-win-x64"
if exist "%NODE_PORTABLE%\node.exe" (
    set "PATH=%NODE_PORTABLE%;%PATH%"
)

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

REM --- Portable Redis (Fallback, wenn Port 6379 frei) ---
set "REDIS_PORTABLE=%LOCALAPPDATA%\redis"
if exist "%REDIS_PORTABLE%\redis-server.exe" (
    netstat -ano | findstr /R /C:"TCP.*:6379 .*0.0.0.0:0" >nul 2>&1
    if errorlevel 1 (
        echo Portable Redis wird gestartet...
        start "" /MIN "%REDIS_PORTABLE%\redis-server.exe" "%REDIS_PORTABLE%\redis.windows.conf"
        timeout /t 2 /nobreak >nul
    )
)

REM --- Alte Showroom-Instanz beenden (verhindert Port-Konflikte/EADDRINUSE) ---
REM Eine zuvor (evtl. minimiert) laufende Instanz blockiert sonst 3000/5050/8001,
REM wodurch der Neustart mit "Port belegt" abbricht. Wir raeumen unsere eigenen
REM Dienste hier auf, bevor wir frisch starten.
echo Eventuell laufende Showroom-Dienste werden beendet...
taskkill /FI "WINDOWTITLE eq META Showroom Stack*" /T /F >nul 2>&1
for %%P in (3000 8001 5050 5051 5052 5053 5054 5055) do (
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:"TCP.*:%%P .*0.0.0.0:0"') do (
        taskkill /PID %%a /F >nul 2>&1
    )
)
REM Kurz warten, bis Windows die Ports wieder freigibt.
timeout /t 2 /nobreak >nul

REM --- Port-Check (3000, 5050, 8001) ---
REM Sollte ein Port jetzt noch belegt sein, haelt ihn eine fremde Anwendung.
call :check_port 3000 "API-Gateway"
if errorlevel 1 goto :port_fail
call :check_port 5050 "Showroom-Vite"
if errorlevel 1 goto :port_fail
call :check_port 8001 "MCP-Server"
if errorlevel 1 goto :port_fail

REM --- Node vorhanden? ---
where node >nul 2>&1
if errorlevel 1 (
    if exist "%NODE_PORTABLE%\node.exe" (
        set "PATH=%NODE_PORTABLE%;%PATH%"
    ) else (
        echo FEHLER: Node.js nicht gefunden.
        echo Erwartet im PATH oder unter: %NODE_PORTABLE%
        pause
        exit /b 1
    )
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

set "STACK_LOG=%LOG_BASE%\stack.log"

start "META Showroom Stack" /MIN cmd /c "set PATH=%NODE_PORTABLE%;%PATH% && cd /d \"%ROOT%\" && set LOG_DIR=%LOG_BASE% && set BLENDER_OUTPUT_DIR=%OUT_BASE% && npx concurrently -n mcp,api,vite -c blue,green,yellow \"npm run start:mcp\" \"npm run start:api\" \"npm run preview\" >> \"%STACK_LOG%\" 2>&1"

REM Kurz warten bis Vite hoert
ping 127.0.0.1 -n 5 >nul

REM --- Browser oeffnen ---
start "" "http://localhost:5050/"

echo Showroom laeuft: http://localhost:5050/
echo.
exit /b 0

:check_port
set "PORT=%~1"
set "LABEL=%~2"
netstat -ano | findstr /R /C:"TCP.*:%PORT% .*0.0.0.0:0" >nul 2>&1
if !errorlevel! equ 0 (
    echo FEHLER: Port %PORT% fuer %LABEL% ist bereits belegt.
    echo        Schliesse andere Anwendungen oder starte den Rechner neu.
    exit /b 1
)
exit /b 0

:port_fail
pause
exit /b 1
