@echo off
setlocal enabledelayedexpansion
title BallotTrack Station Installer
color 1F

:: ============================================
::  Self-elevate to administrator
:: ============================================
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  Requesting administrator permission...
    echo  Click YES on the prompt that appears.
    echo.
    powershell -Command "Start-Process cmd.exe -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs"
    exit /b
)

:: ============================================
::  Configuration — filled in by the server
:: ============================================
set "SERVER_URL=__SERVER_URL__"
set "STATION_ID=__STATION_ID__"

set "INSTALL_DIR=C:\BallotTrack-Agent"
set "WATCH_FOLDER=C:\ScanSnap\Output"

cls
echo.
echo  =============================================
echo   BallotTrack  Station  Setup
echo  =============================================
echo.
echo  This will set up a ballot scanning station.
echo  It only takes a minute or two.
echo.
echo  Server:     %SERVER_URL%
echo  Station ID: %STATION_ID%
echo.
echo  Press any key to begin, or close this window
echo  to cancel.
pause >nul
echo.

:: ============================================
::  STEP 1 — Test server connection
:: ============================================
echo  -------------------------------------------
echo   STEP 1 of 5:  Testing server connection
echo  -------------------------------------------
echo.

powershell -ExecutionPolicy Bypass -Command "$ProgressPreference = 'SilentlyContinue'; try { $r = Invoke-WebRequest '%SERVER_URL%/api/health' -TimeoutSec 5 -UseBasicParsing; if ($r.Content -match 'ok') { exit 0 } } catch {}; exit 1"
if !errorlevel! neq 0 (
    color 4F
    echo.
    echo   Cannot reach the BallotTrack server at:
    echo     %SERVER_URL%
    echo.
    echo   Make sure:
    echo     - This computer is connected to the WiFi
    echo     - The server laptop is running
    echo.
    pause
    exit /b 1
)

echo   [OK] Server is reachable
echo.

:: ============================================
::  STEP 2 — Download Node.js and agent files
:: ============================================
echo  -------------------------------------------
echo   STEP 2 of 5:  Downloading station agent
echo  -------------------------------------------
echo.

mkdir "%INSTALL_DIR%" 2>nul

:: Download the agent bundle (single ZIP: node.exe + agent files + node_modules + config)
echo   Downloading station agent bundle...
echo   (this may take 15-30 seconds)
powershell -ExecutionPolicy Bypass -Command "$ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest '%SERVER_URL%/api/stations/download-bundle?stationId=%STATION_ID%' -OutFile '%INSTALL_DIR%\bundle.zip' -UseBasicParsing"

if not exist "%INSTALL_DIR%\bundle.zip" (
    echo   [ERROR] Failed to download agent bundle from server.
    pause
    exit /b 1
)

:: Extract bundle (overwrites existing files)
echo   Extracting files...
powershell -ExecutionPolicy Bypass -Command "$ProgressPreference = 'SilentlyContinue'; Expand-Archive -Path '%INSTALL_DIR%\bundle.zip' -DestinationPath '%INSTALL_DIR%' -Force"
del "%INSTALL_DIR%\bundle.zip" 2>nul

if not exist "%INSTALL_DIR%\station-agent.js" (
    echo   [ERROR] Extraction failed.
    pause
    exit /b 1
)
if not exist "%INSTALL_DIR%\node.exe" (
    echo   [ERROR] node.exe missing from bundle.
    pause
    exit /b 1
)

echo   [OK] Agent files installed
echo.

:: ============================================
::  STEP 3 — Create scanner watch folder
:: ============================================
echo  -------------------------------------------
echo   STEP 3 of 5:  Setting up scanner folder
echo  -------------------------------------------
echo.

mkdir "%WATCH_FOLDER%" 2>nul

if exist "%WATCH_FOLDER%" (
    echo   [OK] Scanner folder ready: %WATCH_FOLDER%
) else (
    echo   [WARN] Could not create %WATCH_FOLDER%
    echo   You may need to create it manually.
)
echo.

:: ============================================
::  STEP 4 — Install Node.js dependencies
:: ============================================
echo  -------------------------------------------
echo   STEP 4 of 5:  Installing dependencies
echo  -------------------------------------------
echo.

cd /d "%INSTALL_DIR%"

if exist "%INSTALL_DIR%\node_modules\axios" (
    echo   [SKIP] Dependencies already installed
) else (
    :: Use the portable node.exe to run npm (bundled with node)
    :: node.exe standalone doesn't include npm, so we bundle node_modules in the ZIP
    if exist "%INSTALL_DIR%\node_modules" (
        echo   [OK] Dependencies are pre-bundled
    ) else (
        echo   [WARN] node_modules not found in agent ZIP.
        echo   The agent may not start. Contact your admin.
    )
)

echo.

:: ============================================
::  STEP 5 — Create desktop shortcut
:: ============================================
echo  -------------------------------------------
echo   STEP 5 of 5:  Creating desktop shortcut
echo  -------------------------------------------
echo.

:: Copy the launcher bat into the install dir (with auto-restart loop)
> "%INSTALL_DIR%\start-agent.bat" (
    echo @echo off
    echo setlocal
    echo title BallotTrack Station Agent
    echo color 1F
    echo.
    echo cd /d "C:\BallotTrack-Agent"
    echo.
    echo if not exist config.json ^(
    echo     color 4F
    echo     echo.
    echo     echo  ERROR: config.json not found
    echo     echo  Please run the station installer first.
    echo     echo.
    echo     pause
    echo     exit /b 1
    echo ^)
    echo.
    echo if not exist node.exe ^(
    echo     color 4F
    echo     echo.
    echo     echo  ERROR: node.exe not found
    echo     echo  Please run the station installer again.
    echo     echo.
    echo     pause
    echo     exit /b 1
    echo ^)
    echo.
    echo echo.
    echo echo  =============================================
    echo echo   BallotTrack Station Agent
    echo echo  =============================================
    echo echo.
    echo echo   REMINDER: Your ScanSnap scanner must be
    echo echo   configured to save scanned files to:
    echo echo.
    echo echo       C:\ScanSnap\Output
    echo echo.
    echo echo   Format: JPEG    Resolution: 300 DPI
    echo echo  =============================================
    echo echo.
    echo.
    echo :start
    echo node.exe station-agent.js
    echo set EXIT_CODE=%%ERRORLEVEL%%
    echo.
    echo if %%EXIT_CODE%% EQU 0 ^(
    echo     echo.
    echo     echo  Agent exited for update — restarting in 2 seconds...
    echo     timeout /t 2 /nobreak ^>nul
    echo     goto start
    echo ^)
    echo.
    echo echo.
    echo echo  Agent has stopped ^(exit code: %%EXIT_CODE%%^).
    echo echo  Press any key to close this window.
    echo pause ^>nul
)

:: Create shortcut on current user's desktop
powershell -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $desktop = [Environment]::GetFolderPath('Desktop'); $s = $ws.CreateShortcut((Join-Path $desktop 'BallotTrack Station.lnk')); $s.TargetPath = 'C:\BallotTrack-Agent\start-agent.bat'; $s.WorkingDirectory = 'C:\BallotTrack-Agent'; $s.Description = 'Launch BallotTrack Station Agent'; $s.Save(); Write-Output 'ok'"

:: Also put one on the Public desktop (all users)
powershell -ExecutionPolicy Bypass -Command "$s = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $env:PUBLIC 'Desktop\BallotTrack Station.lnk')); $s.TargetPath = 'C:\BallotTrack-Agent\start-agent.bat'; $s.WorkingDirectory = 'C:\BallotTrack-Agent'; $s.Description = 'Launch BallotTrack Station Agent'; $s.Save()" 2>nul

echo   [OK] Desktop shortcut created
echo.

:: ============================================
::  SUCCESS
:: ============================================
cls
color 2F
echo.
echo  =============================================
echo.
echo     Station setup is complete!
echo.
echo  =============================================
echo.
echo   Station ID:   %STATION_ID%
echo   Server:       %SERVER_URL%
echo   Watch folder: %WATCH_FOLDER%
echo.
echo  ---------------------------------------------
echo.
echo   SCANNER SETUP:
echo.
echo   Configure your ScanSnap scanner to save
echo   scanned images to this folder:
echo.
echo       C:\ScanSnap\Output
echo.
echo   Settings:  Format = JPEG
echo              Resolution = 300 DPI
echo              Blank page removal = ON
echo.
echo  ---------------------------------------------
echo.
echo   A shortcut called "BallotTrack Station"
echo   has been placed on the desktop.
echo.
echo   Double-click it each day to start scanning.
echo.
echo  =============================================
echo.

:: Show a Windows popup with the scanner folder reminder
start "" /b powershell -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Configure your ScanSnap scanner to save files to:' + \"`n`n\" + '    C:\ScanSnap\Output' + \"`n`n\" + 'Format: JPEG' + \"`n\" + 'Resolution: 300 DPI' + \"`n\" + 'Blank page removal: ON' + \"`n`n\" + 'A shortcut called \"BallotTrack Station\" has been placed on your desktop. Double-click it each day to start scanning.', 'BallotTrack - Scanner Setup', 'OK', 'Information') | Out-Null"

echo  Press any key to launch the station agent now...
pause >nul

:: Launch the agent
start "BallotTrack Station Agent" "%INSTALL_DIR%\start-agent.bat"
