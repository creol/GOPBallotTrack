@echo off
setlocal enabledelayedexpansion
title Prepare BallotTrack USB Stick
color 1F

echo.
echo  =============================================
echo   Prepare BallotTrack USB Stick
echo  =============================================
echo.
echo  This script copies everything needed onto a
echo  USB stick so a non-technical user can install
echo  BallotTrack by double-clicking install.bat.
echo.
echo  YOU need internet access to download Docker
echo  Desktop (~600 MB). Run this from the GOPBallotTrack
echo  repo folder on YOUR computer.
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

:: ============================================
::  Step 1 — Download Docker Desktop installer
:: ============================================
echo  -------------------------------------------
echo   Step 1 of 3: Docker Desktop Installer
echo  -------------------------------------------
echo.

set "INSTALLER_DIR=%USB_PATH%\installers"
set "DOCKER_EXE=%INSTALLER_DIR%\Docker Desktop Installer.exe"

if exist "%DOCKER_EXE%" (
    echo   [SKIP] Docker Desktop Installer.exe already on USB.
    echo.
    goto :copy_files
)

mkdir "%INSTALLER_DIR%" 2>nul

echo   Downloading Docker Desktop Installer (~600 MB)...
echo   This may take a few minutes depending on your connection.
echo.

:: Try curl first (available on Win10 1803+), then PowerShell
curl --version >nul 2>&1
if %errorlevel% equ 0 (
    curl -L -o "%DOCKER_EXE%" "https://desktop.docker.com/win/main/amd64/Docker%%20Desktop%%20Installer.exe" --progress-bar
) else (
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://desktop.docker.com/win/main/amd64/Docker%%20Desktop%%20Installer.exe' -OutFile '%DOCKER_EXE%'"
)

if not exist "%DOCKER_EXE%" (
    echo.
    echo   [ERROR] Download failed.
    echo   Manually download Docker Desktop Installer from:
    echo     https://www.docker.com/products/docker-desktop
    echo   Save it to: %DOCKER_EXE%
    echo   Then run this script again.
    pause
    exit /b 1
)

echo   [OK] Docker Desktop Installer downloaded.
echo.

:copy_files

:: ============================================
::  Step 2 — Copy application files to USB
:: ============================================
echo  -------------------------------------------
echo   Step 2 of 3: Copying application files
echo  -------------------------------------------
echo.
echo   Copying GOPBallotTrack to %USB_PATH%...
echo.

:: Use robocopy to copy repo, excluding .git, node_modules, and the installers dir
:: (installers are already on USB from step 1)
robocopy "%~dp0." "%USB_PATH%" /E /XD .git node_modules installers /PURGE /NFL /NDL /NJH /NJS /NC /NS >nul 2>&1

if not exist "%USB_PATH%\install.bat" (
    echo   [ERROR] Copy failed. Make sure the USB has enough space.
    pause
    exit /b 1
)

echo   [OK] Application files copied.
echo.

:: ============================================
::  Step 3 — Verify
:: ============================================
echo  -------------------------------------------
echo   Step 3 of 3: Verifying USB contents
echo  -------------------------------------------
echo.

set "ALL_OK=1"

if exist "%USB_PATH%\install.bat" (
    echo   [OK] install.bat
) else (
    echo   [!!] MISSING: install.bat
    set "ALL_OK=0"
)

if exist "%USB_PATH%\docker-compose.prod.yml" (
    echo   [OK] docker-compose.prod.yml
) else (
    echo   [!!] MISSING: docker-compose.prod.yml
    set "ALL_OK=0"
)

if exist "%USB_PATH%\Dockerfile.prod" (
    echo   [OK] Dockerfile.prod
) else (
    echo   [!!] MISSING: Dockerfile.prod
    set "ALL_OK=0"
)

if exist "%USB_PATH%\.env.example" (
    echo   [OK] .env.example
) else (
    echo   [!!] MISSING: .env.example
    set "ALL_OK=0"
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

if exist "%USB_PATH%\client\src" (
    echo   [OK] client\src
) else (
    echo   [!!] MISSING: client source files
    set "ALL_OK=0"
)

echo.

if "%ALL_OK%"=="0" (
    echo  [WARN] Some files are missing. The USB may not work correctly.
    echo.
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
echo   Hand the USB stick to the user with
echo   these instructions:
echo.
echo     1. Plug in the USB stick
echo     2. Open the USB drive in File Explorer
echo     3. Open the GOPBallotTrack folder
echo     4. Double-click install.bat
echo     5. Click YES when asked for permission
echo     6. Wait for it to finish
echo.
echo   If it asks to restart, restart the computer
echo   and double-click install.bat a second time.
echo.
echo   USB contents: %USB_PATH%
echo.
echo  =============================================
echo.
pause
