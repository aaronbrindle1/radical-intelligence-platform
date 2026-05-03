@echo off
title Radical Intelligence Platform
cd /d "%~dp0"
cls

echo.
echo   ╔═══════════════════════════════════════════╗
echo   ║   Radical Intelligence Platform           ║
echo   ╚═══════════════════════════════════════════╝
echo.

:: Check Node.js
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
  echo   Node.js is not installed.
  echo.
  echo   1. Go to https://nodejs.org
  echo   2. Click the green LTS button
  echo   3. Open the downloaded file and click through the installer
  echo   4. Restart your computer, then run this file again
  echo.
  start https://nodejs.org
  echo   Press any key to close...
  pause >nul
  exit /b 1
)
for /f "tokens=1" %%v in ('node --version') do echo   OK: Node.js %%v found
echo.

:: Install if needed
if not exist "node_modules\" (
  echo   First-time setup - installing (takes ~60 seconds)...
  echo   Please stay connected to the internet.
  echo.
  call npm install
  if %ERRORLEVEL% neq 0 (
    echo.
    echo   Installation failed.
    echo   Make sure you are connected to the internet and try again.
    echo.
    echo   Press any key to close...
    pause >nul
    exit /b 1
  )
  echo.
  echo   OK: Setup complete
  echo.
)

:: Check if port 3000 is in use
netstat -ano | findstr ":3000" >nul 2>&1
if %ERRORLEVEL% equ 0 (
  echo   Port 3000 is already in use.
  echo   The app may already be running. Opening browser now...
  echo.
  start http://localhost:3000
  echo   Press any key to close...
  pause >nul
  exit /b 0
)

echo   Starting Radical Intelligence Platform...
echo.
echo   +---------------------------------------------+
echo   ^|  App address:  http://localhost:3000        ^|
echo   ^|  Keep this window OPEN while using the app  ^|
echo   ^|  To stop: close this window                 ^|
echo   +---------------------------------------------+
echo.

:: Open browser after delay
start /b cmd /c "timeout /t 4 /nobreak >nul && start http://localhost:3000"

:: Start server
call npm run dev

if %ERRORLEVEL% neq 0 (
  echo.
  echo   The app stopped unexpectedly.
  echo.
  echo   Common fixes:
  echo   - Restart your computer and try again
  echo   - Delete the node_modules folder and run again
  echo   - Make sure you are connected to the internet
  echo.
)

echo   Press any key to close...
pause >nul
