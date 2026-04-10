@echo off
setlocal
title BallotTrack Station Agent
color 1F

cd /d "C:\BallotTrack-Agent"

if not exist config.json (
    color 4F
    echo.
    echo  =============================================
    echo   ERROR: config.json not found
    echo  =============================================
    echo.
    echo  Please run the station installer first.
    echo.
    pause
    exit /b 1
)

if not exist node.exe (
    color 4F
    echo.
    echo  =============================================
    echo   ERROR: node.exe not found
    echo  =============================================
    echo.
    echo  Please run the station installer again.
    echo.
    pause
    exit /b 1
)

echo.
echo  =============================================
echo   BallotTrack Station Agent
echo  =============================================
echo.
echo   REMINDER: Your ScanSnap scanner must be
echo   configured to save scanned files to:
echo.
echo       C:\ScanSnap\Output
echo.
echo   Format: JPEG    Resolution: 300 DPI
echo  =============================================
echo.

:start
node.exe station-agent.js
set EXIT_CODE=%ERRORLEVEL%

if %EXIT_CODE% EQU 0 (
    echo.
    echo  Agent exited for update — restarting in 2 seconds...
    timeout /t 2 /nobreak >nul
    goto start
)

echo.
echo  Agent has stopped (exit code: %EXIT_CODE%).
echo  Press any key to close this window.
pause >nul
