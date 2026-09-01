@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\bootstrap.ps1" %*
if errorlevel 1 goto :error
exit /b 0

:error
echo.
echo Impossible d'installer ou de lancer Build Analyzer.
pause
exit /b 1
