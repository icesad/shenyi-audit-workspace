@echo off
setlocal DisableDelayedExpansion
"%SystemRoot%\System32\chcp.com" 65001 >nul
cd /d "%~dp0" || exit /b 1
set "NODE_OPTIONS="
set "NODE_PATH="
set "NODE_V8_COVERAGE="
set "PATH=%SystemRoot%\System32;%SystemRoot%"
if not exist "%~dp0runtime\node\node.exe" (
  echo 请先完整解压 Windows 双人评审包，然后双击包内同名入口。
  pause
  exit /b 1
)
"%~dp0runtime\node\node.exe" "%~dp0scripts\team-website-checkout-owner-review.mjs"
set "REVIEW_EXIT=%errorlevel%"
if not "%REVIEW_EXIT%"=="0" pause
exit /b %REVIEW_EXIT%
