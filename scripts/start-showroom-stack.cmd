@echo off
setlocal

set "ROOT=%~dp0.."
cd /d "%ROOT%"

set "LOG_BASE=%LOCALAPPDATA%\meta-showroom\logs"
set "OUT_BASE=%LOCALAPPDATA%\meta-showroom\outputs"
if not exist "%LOG_BASE%" mkdir "%LOG_BASE%"
if not exist "%OUT_BASE%" mkdir "%OUT_BASE%"

set "LOG_DIR=%LOG_BASE%"
set "BLENDER_OUTPUT_DIR=%OUT_BASE%"
set "PORT=3000"
call npm run dev:full >> "%LOG_BASE%\stack.log" 2>&1