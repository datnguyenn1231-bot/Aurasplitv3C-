@echo off
title AuraSplit v2 - DEV MODE
echo ============================================
echo   AuraSplit v2 - Starting DEV mode...
echo ============================================
echo.

cd /d "%~dp0"

echo [1/2] Checking dependencies...
if not exist "node_modules" (
    echo Installing npm packages...
    npm install
)

echo [2/2] Starting Electron app...
echo.
echo   Press Ctrl+C to stop
echo ============================================
npm run dev

pause
