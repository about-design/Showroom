@echo off
setlocal EnableDelayedExpansion

echo.
echo META Showroom wird beendet...
echo.

REM Fenster mit Titel "META Showroom Stack" schliessen
taskkill /FI "WINDOWTITLE eq META Showroom Stack*" /F >nul 2>&1

REM Prozesse auf typischen Showroom-Ports beenden (nur localhost-Stack)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":5050 .*LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":3000 .*LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:":8001 .*LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)

REM concurrently / node Kinderprozesse (Vorsicht: nur wenn im Showroom-Ordner)
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
for /f "tokens=2" %%p in ('wmic process where "CommandLine like '%%concurrently%%'" get ProcessId /format:list 2^>nul ^| findstr "="') do (
    taskkill /PID %%p /F >nul 2>&1
)

echo Fertig. Ports 3000, 5050, 8001 sollten frei sein.
echo.
timeout /t 2 /nobreak >nul
