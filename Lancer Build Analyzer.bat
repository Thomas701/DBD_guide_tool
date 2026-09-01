@echo off
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js est requis pour lancer Build Analyzer.
  pause
  exit /b 1
)
if not exist "node_modules\vite\bin\vite.js" (
  echo Installation initiale des dependances...
  call npm install || goto :error
)
node scripts\start-app.mjs
exit /b %errorlevel%

:error
echo Impossible de preparer Build Analyzer.
pause
exit /b 1
