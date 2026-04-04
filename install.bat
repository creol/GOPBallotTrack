@echo off
setlocal

echo ============================================
echo  BallotTrack Installer
echo ============================================
echo.

:: ---- Check for Git ----
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Git is not installed or not in PATH.
    echo         Download from: https://git-scm.com/downloads
    pause
    exit /b 1
)

:: ---- Check for Docker ----
where docker >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker is not installed or not in PATH.
    echo         Download Docker Desktop from: https://www.docker.com/products/docker-desktop
    pause
    exit /b 1
)

:: ---- Check Docker is running ----
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker Desktop is not running. Please start it and try again.
    pause
    exit /b 1
)

echo [OK] Git found
echo [OK] Docker found and running
echo.

:: ---- Clone repository ----
set "INSTALL_DIR=C:\GOPBallotTrack"

if exist "%INSTALL_DIR%\.git" (
    echo [SKIP] Repository already exists at %INSTALL_DIR%
    echo        Pulling latest changes...
    cd /d "%INSTALL_DIR%"
    git pull
) else (
    if exist "%INSTALL_DIR%" (
        echo [WARN] %INSTALL_DIR% exists but is not a git repo.
        echo        Please remove it first or choose a different location.
        pause
        exit /b 1
    )
    echo [1/4] Cloning repository to %INSTALL_DIR%...
    git clone https://github.com/creol/GOPBallotTrack.git "%INSTALL_DIR%"
    if %errorlevel% neq 0 (
        echo [ERROR] Git clone failed.
        pause
        exit /b 1
    )
)

cd /d "%INSTALL_DIR%"
echo.

:: ---- Create scanner folders ----
echo [2/4] Creating scanner and processing folders...

mkdir "%INSTALL_DIR%\data\scans\scanner1\incoming" 2>nul
mkdir "%INSTALL_DIR%\data\scans\scanner2\incoming" 2>nul
mkdir "%INSTALL_DIR%\data\scans\processed" 2>nul
mkdir "%INSTALL_DIR%\data\scans\errors" 2>nul
mkdir "%INSTALL_DIR%\data\scans\flagged" 2>nul

echo        data\scans\scanner1\incoming  - OK
echo        data\scans\scanner2\incoming  - OK
echo        data\scans\processed          - OK
echo        data\scans\errors             - OK
echo        data\scans\flagged            - OK
echo.

:: ---- Create .env if missing ----
echo [3/4] Checking environment file...

if not exist "%INSTALL_DIR%\.env" (
    if exist "%INSTALL_DIR%\.env.example" (
        copy "%INSTALL_DIR%\.env.example" "%INSTALL_DIR%\.env" >nul
        echo        Created .env from .env.example
        echo        ** IMPORTANT: Edit C:\GOPBallotTrack\.env to change your PINs and DB password **
    ) else (
        echo [WARN] No .env.example found. You will need to create .env manually.
    )
) else (
    echo        .env already exists - OK
)
echo.

:: ---- Build and start Docker containers ----
echo [4/4] Building and starting Docker containers...
echo        This may take several minutes on first run.
echo.

docker-compose -f docker-compose.prod.yml up --build -d
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Docker build/start failed. Check the output above for details.
    pause
    exit /b 1
)

echo.
echo ============================================
echo  BallotTrack installed successfully!
echo ============================================
echo.
echo  App running at:  http://localhost:3000
echo  Admin dashboard: http://localhost:3000/admin
echo  Login page:      http://localhost:3000/login
echo.
echo  Default PINs (change in C:\GOPBallotTrack\.env):
echo    Admin: 1234
echo    Judge: 5678
echo    Chair: 9012
echo.
echo  Scanner folders ready at:
echo    C:\GOPBallotTrack\data\scans\scanner1\incoming
echo    C:\GOPBallotTrack\data\scans\scanner2\incoming
echo.
echo  Point each physical scanner's output to the
echo  matching incoming folder above (JPEG format).
echo.
echo  To stop:  docker-compose -f docker-compose.prod.yml down
echo  To start: docker-compose -f docker-compose.prod.yml up -d
echo ============================================
pause
