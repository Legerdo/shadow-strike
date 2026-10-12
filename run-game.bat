@echo off
setlocal
title SHADOW STRIKE

rem Run from the project directory, even when launched by double-click.
pushd "%~dp0"
if errorlevel 1 (
    echo [ERROR] Could not open the game directory.
    pause
    exit /b 1
)

where node.exe >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is required. Install Node.js and try again.
    goto :failed
)

where npm.cmd >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm was not found. Check your Node.js installation.
    goto :failed
)

if not exist "node_modules\.bin\vite.cmd" (
    echo [SHADOW STRIKE] Installing dependencies...
    call npm.cmd ci
    if errorlevel 1 goto :failed
)

echo [SHADOW STRIKE] Starting the game...
echo The game will open in your default browser.
echo Keep this window open while playing. Close it to stop the server.
echo.
call npm.cmd run dev -- --host 127.0.0.1 --open
if errorlevel 1 goto :failed

popd
exit /b 0

:failed
echo.
echo [ERROR] The game could not be started.
pause
popd
exit /b 1
