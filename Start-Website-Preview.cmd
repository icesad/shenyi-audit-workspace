@echo off
setlocal
cd /d "%~dp0"
set "SHENYI_WEBSITE_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%SHENYI_WEBSITE_NODE%" set "SHENYI_WEBSITE_NODE=node"
"%SHENYI_WEBSITE_NODE%" scripts\website-preview.mjs --open
set "SHENYI_WEBSITE_EXIT=%ERRORLEVEL%"
if not "%SHENYI_WEBSITE_EXIT%"=="0" pause
exit /b %SHENYI_WEBSITE_EXIT%
