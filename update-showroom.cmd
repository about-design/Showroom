@echo off
setlocal EnableDelayedExpansion

REM META Showroom - Update fuer Anwender/Entwickler (Windows, Git-Checkout)
REM Holt den neuesten Stand des aktuellen Branches, installiert Abhaengigkeiten,
REM baut das Frontend (dist\) neu und startet den Showroom neu.
REM
REM Voraussetzung: Dieses Skript liegt im Projektroot (Git-Checkout), nicht im
REM ZIP-Rollout-Paket der IT (dafuer: install-windows.ps1 -Update, siehe
REM docs/windows-it-rollout.md).

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
cd /d "%ROOT%"

echo.
echo ============================================
echo  META Showroom - Update
echo  Projekt: %ROOT%
echo ============================================
echo.

REM --- Node.js: portable Fallback (wie start-showroom.cmd) ---
set "NODE_PORTABLE=%LOCALAPPDATA%\nodejs\node-v20.20.2-win-x64"
if exist "%NODE_PORTABLE%\node.exe" (
    set "PATH=%NODE_PORTABLE%;%PATH%"
)
where node >nul 2>&1
if errorlevel 1 (
    echo FEHLER: Node.js nicht gefunden.
    echo Erwartet im PATH oder unter: %NODE_PORTABLE%
    pause
    exit /b 1
)

REM --- Git-Checkout? ---
if not exist "%ROOT%\.git" (
    echo FEHLER: Kein Git-Checkout gefunden ^(.git fehlt^).
    echo Dieses Skript ist fuer Entwickler-/Kollegen-Checkouts gedacht.
    echo Fuer IT-ZIP-Rollouts stattdessen: install-windows.ps1 -Update
    pause
    exit /b 1
)

REM --- Laufenden Stack stoppen (verhindert Datei-Locks beim Build) ---
if exist "%ROOT%\stop-showroom.cmd" (
    echo Laufenden Showroom stoppen...
    call "%ROOT%\stop-showroom.cmd"
)

REM --- Aktuellen Branch ermitteln und pullen ---
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%b"
echo.
echo Branch: %BRANCH%
echo Hole neuesten Stand von origin/%BRANCH% ...
git pull --ff-only origin %BRANCH%
if errorlevel 1 (
    echo.
    echo FEHLER: git pull fehlgeschlagen ^(lokale Aenderungen/Konflikte?^).
    echo Bitte manuell pruefen: git status
    pause
    exit /b 1
)

REM --- Abhaengigkeiten aktualisieren ---
echo.
echo npm install ...
call npm install
if errorlevel 1 (
    echo FEHLER: npm install fehlgeschlagen.
    pause
    exit /b 1
)

REM --- Frontend neu bauen (dist\) ---
echo.
echo npm run build ...
call npm run build
if errorlevel 1 (
    echo FEHLER: npm run build fehlgeschlagen. Siehe Meldungen oben.
    pause
    exit /b 1
)

echo.
echo Update fertig. Showroom wird neu gestartet...
echo.

REM --- Neu starten ---
if exist "%ROOT%\start-showroom.cmd" (
    call "%ROOT%\start-showroom.cmd"
) else (
    echo HINWEIS: start-showroom.cmd nicht gefunden - bitte manuell starten.
    pause
)

exit /b 0
