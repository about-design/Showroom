@echo off
setlocal EnableDelayedExpansion

echo.
echo META Showroom wird beendet...
echo.

REM Fenster mit Titel "META Showroom Stack" schliessen
taskkill /FI "WINDOWTITLE eq META Showroom Stack*" /F >nul 2>&1

REM Prozesse auf typischen Showroom-Ports beenden (TCP, unabhaengig von LISTENING/ABHOEREN)
for %%P in (5050 5051 5052 5053 5054 5055) do (
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:"TCP.*:%%P .*0.0.0.0:0"') do (
        taskkill /PID %%a /F >nul 2>&1
    )
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:"TCP.*:3000 .*0.0.0.0:0"') do (
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:"TCP.*:8001 .*0.0.0.0:0"') do (
    taskkill /PID %%a /F >nul 2>&1
)

REM concurrently / node Kinderprozesse (Vorsicht: nur wenn im Showroom-Ordner)
set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
for /f "tokens=2" %%p in ('wmic process where "CommandLine like '%%concurrently%%'" get ProcessId /format:list 2^>nul ^| findstr "="') do (
    taskkill /PID %%p /F >nul 2>&1
)

echo Fertig. Ports 3000, 5050–5055, 8001 sollten frei sein.
echo.
