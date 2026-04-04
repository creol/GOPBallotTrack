@echo off
setlocal enabledelayedexpansion
title BallotTrack Installer
color 1F

:: ============================================
::  Self-elevate to administrator (required for
::  Docker install and Windows features)
:: ============================================
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  Requesting administrator permission...
    echo  Click YES on the prompt that appears.
    echo.
    powershell -Command "Start-Process cmd.exe -ArgumentList '/c \"\"%~f0\"\"' -Verb RunAs" 2>nul
    if %errorlevel% neq 0 (
        echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\bt_elevate.vbs"
        echo UAC.ShellExecute "cmd.exe", "/c ""%~f0""", "", "runas", 1 >> "%temp%\bt_elevate.vbs"
        cscript //nologo "%temp%\bt_elevate.vbs"
        del "%temp%\bt_elevate.vbs" 2>nul
    )
    exit /b
)

set "INSTALL_DIR=C:\GOPBallotTrack"
set "SCRIPT_DIR=%~dp0"

cls
echo.
echo  =============================================
echo       B A L L O T T R A C K   S E T U P
echo  =============================================
echo.
echo  This will install BallotTrack on this computer.
echo  The process takes about 10-15 minutes.
echo.
echo  Press any key to begin, or close this window to cancel.
pause >nul
echo.

:: ============================================
::  STEP 1 — Check if Docker Desktop is installed
:: ============================================
echo  -------------------------------------------
echo   STEP 1 of 5:  Checking for Docker Desktop
echo  -------------------------------------------
echo.

:: Check for docker command
where docker >nul 2>&1
if %errorlevel% equ 0 (
    echo   [OK] Docker Desktop is already installed.
    echo.
    goto :check_docker_running
)

:: Docker not installed — find the installer
echo   Docker Desktop is NOT installed on this computer.
echo   Looking for the installer...
echo.

set "DOCKER_INSTALLER="
if exist "%SCRIPT_DIR%installers\Docker Desktop Installer.exe" (
    set "DOCKER_INSTALLER=%SCRIPT_DIR%installers\Docker Desktop Installer.exe"
)
if not defined DOCKER_INSTALLER if exist "%INSTALL_DIR%\installers\Docker Desktop Installer.exe" (
    set "DOCKER_INSTALLER=%INSTALL_DIR%\installers\Docker Desktop Installer.exe"
)

if not defined DOCKER_INSTALLER (
    echo.
    echo   *** INSTALLER NOT FOUND ***
    echo.
    echo   The file "Docker Desktop Installer.exe" was not found in
    echo   the "installers" folder next to this script.
    echo.
    echo   Ask your IT contact to prepare the USB stick using
    echo   prepare-usb.bat before handing it to you.
    echo.
    pause
    exit /b 1
)

echo   Found installer: %DOCKER_INSTALLER%
echo.
echo   Installing Docker Desktop now...
echo   This takes 5-10 minutes. Please wait.
echo   (You may see a progress window appear.)
echo.

"%DOCKER_INSTALLER%" install --quiet --accept-license
if %errorlevel% neq 0 (
    echo.
    echo   Docker install may have finished with a warning.
    echo   This is usually OK. Continuing...
    echo.
)

:: After first Docker install, a restart is almost always required
echo.
echo  =============================================
echo   RESTART REQUIRED
echo  =============================================
echo.
echo   Docker Desktop has been installed, but your
echo   computer must restart to finish setup.
echo.
echo   AFTER YOUR COMPUTER RESTARTS:
echo.
echo     1. Wait 1-2 minutes for Docker Desktop
echo        to finish starting (look for the whale
echo        icon in the bottom-right system tray).
echo.
echo     2. Double-click install.bat AGAIN to
echo        finish the BallotTrack setup.
echo.
echo  =============================================
echo.
echo  Press any key to restart this computer now...
pause >nul
shutdown /r /t 15 /c "Restarting to finish BallotTrack/Docker setup. Run install.bat again after restart."
exit /b

:: ============================================
::  Docker is installed — make sure it's running
:: ============================================
:check_docker_running
echo  -------------------------------------------
echo   STEP 2 of 5:  Starting Docker Desktop
echo  -------------------------------------------
echo.

docker info >nul 2>&1
if %errorlevel% equ 0 (
    echo   [OK] Docker Desktop is running.
    echo.
    goto :docker_ready
)

echo   Docker Desktop is installed but not running.
echo   Starting it now...
echo.

:: Try common install locations
if exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" (
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
) else if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" (
    start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
) else (
    echo   Could not find Docker Desktop to start it.
    echo   Please start Docker Desktop manually from the Start Menu,
    echo   then run this installer again.
    pause
    exit /b 1
)

echo   Waiting for Docker to start up...
echo   (This can take 1-2 minutes)
echo.

set "DOCKER_WAIT=0"
:docker_wait_loop
timeout /t 5 /nobreak >nul
docker info >nul 2>&1
if %errorlevel% equ 0 goto :docker_started
set /a DOCKER_WAIT+=5
if %DOCKER_WAIT% geq 180 (
    echo.
    echo   Docker hasn't started after 3 minutes.
    echo   Please wait for the whale icon in the system tray
    echo   to stop animating, then run this installer again.
    pause
    exit /b 1
)
echo   Still waiting... (%DOCKER_WAIT% seconds)
goto :docker_wait_loop

:docker_started
echo   [OK] Docker Desktop is running.
echo.

:docker_ready

:: ============================================
::  STEP 3 — Copy application files
:: ============================================
echo  -------------------------------------------
echo   STEP 3 of 5:  Copying application files
echo  -------------------------------------------
echo.

:: Detect if we're running from the install dir already
set "SCRIPT_DIR_CLEAN=%SCRIPT_DIR:~0,-1%"
if /i "%SCRIPT_DIR_CLEAN%"=="%INSTALL_DIR%" (
    echo   Already running from %INSTALL_DIR% — skipping copy.
    echo.
    goto :create_folders
)

:: Check that source files exist
if not exist "%SCRIPT_DIR%docker-compose.prod.yml" (
    echo   [ERROR] Cannot find application files next to this script.
    echo   Make sure install.bat is inside the GOPBallotTrack folder.
    pause
    exit /b 1
)

echo   Copying BallotTrack to %INSTALL_DIR%...

:: Use robocopy — skip .git, node_modules, installers folder (large files)
robocopy "%SCRIPT_DIR%." "%INSTALL_DIR%" /E /XD .git node_modules installers /XF .env /NFL /NDL /NJH /NJS /NC /NS >nul 2>&1

if exist "%INSTALL_DIR%\docker-compose.prod.yml" (
    echo   [OK] Application files copied.
) else (
    echo   [ERROR] File copy failed. Check that this USB drive is readable.
    pause
    exit /b 1
)
echo.

:create_folders

:: ============================================
::  STEP 4 — Create scanner folders & config
:: ============================================
echo  -------------------------------------------
echo   STEP 4 of 5:  Creating folders and config
echo  -------------------------------------------
echo.

:: Scanner watch folders
mkdir "%INSTALL_DIR%\data\scans\scanner1\incoming" 2>nul
mkdir "%INSTALL_DIR%\data\scans\scanner2\incoming" 2>nul

:: Processing folders
mkdir "%INSTALL_DIR%\data\scans\processed" 2>nul
mkdir "%INSTALL_DIR%\data\scans\errors" 2>nul
mkdir "%INSTALL_DIR%\data\scans\flagged" 2>nul

:: Uploads
mkdir "%INSTALL_DIR%\uploads" 2>nul

echo   [OK] Scanner folders created:
echo        %INSTALL_DIR%\data\scans\scanner1\incoming
echo        %INSTALL_DIR%\data\scans\scanner2\incoming
echo.

:: Create .env from example if not present
if not exist "%INSTALL_DIR%\.env" (
    if exist "%INSTALL_DIR%\.env.example" (
        copy "%INSTALL_DIR%\.env.example" "%INSTALL_DIR%\.env" >nul
        echo   [OK] Configuration file created with default PINs.
    ) else (
        echo   [WARN] No .env.example found — you may need to create .env manually.
    )
) else (
    echo   [OK] Configuration file already exists.
)
echo.

:: ============================================
::  STEP 5 — Build and start the application
:: ============================================
echo  -------------------------------------------
echo   STEP 5 of 5:  Building and starting app
echo  -------------------------------------------
echo.
echo   This takes 3-5 minutes on first run.
echo   Please wait...
echo.

cd /d "%INSTALL_DIR%"

:: Detect whether to use "docker compose" (plugin) or "docker-compose" (standalone)
docker compose version >nul 2>&1
if %errorlevel% equ 0 (
    set "COMPOSE=docker compose"
) else (
    set "COMPOSE=docker-compose"
)

%COMPOSE% -f docker-compose.prod.yml up --build -d
if %errorlevel% neq 0 (
    echo.
    echo   [ERROR] Failed to build or start the application.
    echo.
    echo   Make sure Docker Desktop is fully started (whale icon
    echo   in system tray is steady, not spinning) and try again.
    echo.
    pause
    exit /b 1
)

:: ============================================
::  Get the local WiFi IP address
:: ============================================
set "LOCAL_IP="
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "127.0.0.1"') do (
    set "IP_RAW=%%a"
    for /f "tokens=*" %%b in ("!IP_RAW!") do set "LOCAL_IP=%%b"
    goto :got_ip
)
:got_ip

:: ============================================
::  SUCCESS
:: ============================================
cls
color 2F
echo.
echo  =============================================
echo   BallotTrack is installed and running!
echo  =============================================
echo.
echo.
echo   OPEN YOUR WEB BROWSER AND GO TO:
echo.
echo       http://localhost:3000/admin
echo.
echo.
if defined LOCAL_IP (
echo   FOR OTHER DEVICES ON THE WIFI, USE:
echo.
echo       Admin:       http://!LOCAL_IP!:3000/admin
echo       Public:      http://!LOCAL_IP!:3000/public
echo       TV Display:  http://!LOCAL_IP!:3000/public?mode=tv
echo.
echo.
)
echo   LOGIN PINS (defaults — can be changed later):
echo.
echo       Admin PIN:   1234
echo       Judge PIN:   5678
echo       Chair PIN:   9012
echo.
echo.
echo   SCANNER SETUP:
echo.
echo       Point each scanner's output folder to:
echo       C:\GOPBallotTrack\data\scans\scanner1\incoming
echo       C:\GOPBallotTrack\data\scans\scanner2\incoming
echo.
echo.
echo   TO STOP THE APP:    Open a command prompt and run:
echo       cd C:\GOPBallotTrack
echo       docker compose -f docker-compose.prod.yml down
echo.
echo   TO START IT AGAIN:  Double-click install.bat
echo       (it will skip all install steps and just start the app)
echo.
echo  =============================================
echo.
pause
