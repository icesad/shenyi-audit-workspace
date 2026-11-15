@echo off
setlocal
cd /d "%~dp0"
set "SHENYI_PREVIEW_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%SHENYI_PREVIEW_NODE%" set "SHENYI_PREVIEW_NODE=node"
"%SHENYI_PREVIEW_NODE%" scripts\team-desktop-dev.mjs
if errorlevel 1 pause
