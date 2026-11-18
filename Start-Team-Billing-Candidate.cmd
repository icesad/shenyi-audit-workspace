@echo off
setlocal
cd /d "%~dp0"
set "SHENYI_PREVIEW_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%SHENYI_PREVIEW_NODE%" set "SHENYI_PREVIEW_NODE=node"
"%SHENYI_PREVIEW_NODE%" scripts\team-isolated-preview.mjs --billing-demo
set "SHENYI_BILLING_PREVIEW_EXIT=%ERRORLEVEL%"
if not "%SHENYI_BILLING_PREVIEW_EXIT%"=="0" pause
exit /b %SHENYI_BILLING_PREVIEW_EXIT%
