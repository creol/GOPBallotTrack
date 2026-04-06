@echo off
setlocal enabledelayedexpansion
title Prepare BallotTrack Server USB
color 1F

echo.
echo  =============================================
echo   Prepare BallotTrack Server USB
echo  =============================================
echo.
echo  This prepares a USB stick to install the
echo  BallotTrack SERVER on a laptop that has no
echo  internet access.
echo.
echo  Scanning stations do NOT need this USB —
echo  they install directly from the server via
echo  the station-setup web page.
echo.
echo  YOU need internet access to run this script.
echo.

:: ============================================
::  Ask for USB drive letter
:: ============================================
set /p "USB_DRIVE=Enter the USB drive letter (e.g. E): "
set "USB_DRIVE=%USB_DRIVE:~0,1%"
set "USB_PATH=%USB_DRIVE%:\GOPBallotTrack"

if not exist "%USB_DRIVE%:\" (
    echo.
    echo  [ERROR] Drive %USB_DRIVE%:\ does not exist.
    pause
    exit /b 1
)

echo.
echo  Files will be copied to: %USB_PATH%
echo.
echo  Press any key to continue, or close to cancel.
pause >nul
echo.

set "INSTALLER_DIR=%USB_PATH%\installers"
mkdir "%INSTALLER_DIR%" 2>nul

:: ============================================
::  Step 1 — Download Docker Desktop installer
:: ============================================
echo  -------------------------------------------
echo   Step 1 of 3: Docker Desktop Installer
echo  -------------------------------------------
echo.

set "DOCKER_EXE=%INSTALLER_DIR%\Docker Desktop Installer.exe"

if exist "%DOCKER_EXE%" (
    echo   [SKIP] Docker Desktop Installer.exe already on USB.
    echo.
    goto :copy_files
)

echo   Downloading Docker Desktop Installer (~600 MB)...
echo   This may take a few minutes.
echo.

curl --version >nul 2>&1
if %errorlevel% equ 0 (
    curl -L -o "%DOCKER_EXE%" "https://desktop.docker.com/win/main/amd64/Docker%%20Desktop%%20Installer.exe" --progress-bar
) else (
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://desktop.docker.com/win/main/amd64/Docker%%20Desktop%%20Installer.exe' -OutFile '%DOCKER_EXE%'"
)

if not exist "%DOCKER_EXE%" (
    echo.
    echo   [ERROR] Download failed.
    echo   Manually download Docker Desktop from:
    echo     https://www.docker.com/products/docker-desktop
    echo   Save it to: %DOCKER_EXE%
    pause
    exit /b 1
)

echo   [OK] Docker Desktop Installer downloaded.
echo.

:: ============================================
::  Step 2 — Copy server files to USB
:: ============================================
:copy_files
echo  -------------------------------------------
echo   Step 2 of 3: Copying server files
echo  -------------------------------------------
echo.
echo   Copying GOPBallotTrack to %USB_PATH%...
echo.

robocopy "%~dp0." "%USB_PATH%" /E /XD .git node_modules installers /XF .env /PURGE /NFL /NDL /NJH /NJS /NC /NS >nul 2>&1

if not exist "%USB_PATH%\install.bat" (
    echo   [ERROR] Copy failed. Make sure the USB has enough space.
    pause
    exit /b 1
)

echo   [OK] Server files copied.
echo.

:: ============================================
::  Step 3 — Verify
:: ============================================
echo  -------------------------------------------
echo   Step 3 of 3: Verifying USB contents
echo  -------------------------------------------
echo.

set "ALL_OK=1"

for %%f in (install.bat docker-compose.prod.yml Dockerfile.prod .env.example) do (
    if exist "%USB_PATH%\%%f" (
        echo   [OK] %%f
    ) else (
        echo   [!!] MISSING: %%f
        set "ALL_OK=0"
    )
)

if exist "%DOCKER_EXE%" (
    echo   [OK] installers\Docker Desktop Installer.exe
) else (
    echo   [!!] MISSING: Docker Desktop Installer.exe
    set "ALL_OK=0"
)

if exist "%USB_PATH%\server\src\index.js" (
    echo   [OK] server\src\index.js
) else (
    echo   [!!] MISSING: server source files
    set "ALL_OK=0"
)

echo.

if "%ALL_OK%"=="0" (
    echo  [WARN] Some files are missing.
    pause
    exit /b 1
)

:: ============================================
::  Done
:: ============================================
color 2F
echo.
echo  =============================================
echo   USB stick is ready!
echo  =============================================
echo.
echo   FOR THE SERVER LAPTOP:
echo.
echo     1. Open GOPBallotTrack folder on USB
echo     2. Double-click install.bat
echo     3. Click YES, wait for it to finish
echo     4. Restart if prompted, then run again
echo.
echo   SCANNING STATIONS don't need this USB.
echo   Once the server is running, go to:
echo.
echo     http://[server-ip]:3000/station-setup
echo.
echo   on each station laptop to download and
echo   install the agent automatically.
echo.
echo  =============================================
echo.
pause
