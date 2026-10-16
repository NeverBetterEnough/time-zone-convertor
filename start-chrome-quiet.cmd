@echo off
setlocal DisableDelayedExpansion
rem Optional: suppress ALL extension debugger warning bars in this Chrome process.
rem This does not disable debugging or make extensions more trustworthy.
set "TZ_CHROME_PATH="
if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "TZ_CHROME_PATH=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "TZ_CHROME_PATH=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "TZ_CHROME_PATH=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined TZ_CHROME_PATH (
  echo Google Chrome was not found in a standard installation directory.
  echo Add --silent-debugger-extension-api to your own Chrome shortcut instead.
  if /i not "%~1"=="--dry-run" pause
  exit /b 1
)
echo This launch hides debugger warning bars for ALL extensions in this Chrome instance.
if /i "%~1"=="--dry-run" (
  echo "%TZ_CHROME_PATH%" --silent-debugger-extension-api
  exit /b 0
)
%SystemRoot%\System32\tasklist.exe /FI "IMAGENAME eq chrome.exe" /NH 2>nul | %SystemRoot%\System32\find.exe /I "chrome.exe" >nul
if not errorlevel 1 (
  echo Chrome is already running. Save your work and fully exit Chrome first.
  echo If background Chrome processes remain, exit Chrome from its tray icon.
  echo Then run this file again. No Chrome processes have been closed by this script.
  pause
  exit /b 1
)
start "" "%TZ_CHROME_PATH%" --silent-debugger-extension-api
exit /b 0
