# BallotTrack

BallotTrack is a self-hosted election management and ballot scanning system designed for political conventions. It runs entirely on a local LAN via closed WiFi with no internet dependency, hosted on a laptop using Docker. It handles ballot generation with QR codes, multi-pass scanning with double-count prevention, judge confirmation with mismatch override, chair preview and release, and a public TV/mobile dashboard where voters can search their ballot serial number and view their scanned ballot image.

## Prerequisites

- [Docker](https://www.docker.com/products/docker-desktop) and Docker Compose
- A laptop or server to host the system
- A closed WiFi network (no internet required after setup)

## Quick Start

```bash
# Clone the repository
git clone https://github.com/creol/GOPBallotTrack.git
cd GOPBallotTrack

# Copy environment file and set your PINs
cp .env.example .env
# Edit .env and change ADMIN_PIN, JUDGE_PIN, CHAIR_PIN

# Development mode (hot reload)
docker-compose up

# Production mode (single port, optimized build)
docker-compose -f docker-compose.prod.yml up --build
```

## Default URLs

| URL | Purpose | Auth Required |
|-----|---------|---------------|
| `http://localhost:3000/admin` | Admin dashboard | Yes (Admin/Chair PIN) |
| `http://localhost:3000/scan/:roundId` | Scanner for tally operators | No |
| `http://localhost:3000/public/:electionId` | Public dashboard (TV/mobile) | No |
| `http://localhost:3000/login` | Login page | — |

In development mode, the Vite dev server runs on port **5173** with hot reload.

## Default PINs (change these!)

| Role | PIN | Access |
|------|-----|--------|
| Admin | 1234 | Manage elections, races, ballots, exports |
| Judge | 5678 | Confirm rounds, override mismatches |
| Chair | 9012 | All judge + admin permissions, release results |

Tally operators access the scanner directly via a shared link — no PIN needed.

## Workflow

1. **Admin** creates an election, races, candidates, and ballot boxes
2. **Admin** creates a round (selects paper color), generates ballot PDFs
3. **Admin** prints ballots (PDF download) — data ZIP is separate
4. **Tally Operators** scan ballots via QR codes or manual SN entry (Pass 1 + Pass 2)
5. **Election Judge** reviews pass comparison, confirms results (or overrides with notes)
6. **Chair** previews the public dashboard, then releases results
7. **Public** views results on TV (auto-updating) or mobile, searches ballot SN

## Architecture

- **Backend**: Node.js + Express + Socket.IO
- **Frontend**: React (Vite)
- **Database**: PostgreSQL 16
- **PDF Generation**: PDFKit
- **QR Codes**: qrcode (generation) + html5-qrcode (scanning)
- **Deployment**: Docker Compose — 2 containers (app + postgres) + persistent volume

## Deploying to a New Laptop

### 1. Install Docker Desktop

Download and install Docker Desktop for Windows from:
https://www.docker.com/products/docker-desktop

After install, open Docker Desktop and wait for the engine to start (green icon in system tray).

### 2. Install Scanner Drivers (Fujitsu fi-series)

If using Fujitsu fi-series ADF scanners (e.g., fi-7160, fi-7180, fi-8170):

1. Download the PaperStream IP (TWAIN) driver from:
   https://www.fujitsu.com/global/support/products/computing/peripheral/scanners/fi/software/
2. Install and restart if prompted
3. Open **PaperStream IP Driver** to verify each scanner is detected
4. Set the scan output format to **JPEG** and output folder to `data\scans\<scanner-name>\incoming` (see below)

### 3. Clone the Repo and Configure

```bash
git clone https://github.com/creol/GOPBallotTrack.git
cd GOPBallotTrack

# Copy and edit the environment file
cp .env.example .env
```

Edit `.env` and change the PINs and database password:

```
ADMIN_PIN=<your-admin-pin>
JUDGE_PIN=<your-judge-pin>
CHAIR_PIN=<your-chair-pin>
DB_PASSWORD=<your-db-password>
```

### 4. Create Scanner Folders

The ADF scanners deposit scanned images into watched folders. These folders are **not** auto-created on the host — you must create them before starting Docker.

From the project root:

```bash
mkdir -p data/scans/scanner1/incoming
mkdir -p data/scans/scanner2/incoming
mkdir -p data/scans/scanner3/incoming
# ... repeat for as many scanners as you need (up to scanner10, etc.)
```

The processing folders (`processed`, `flagged`, `errors`) inside `data/scans/` are created automatically by the app on startup.

Configure each physical scanner's output folder to point to the matching `data\scans\<name>\incoming` path. For example, Scanner 1 outputs to `C:\path\to\GOPBallotTrack\data\scans\scanner1\incoming`.

### 5. Start the Application

**Production mode** (recommended for convention day):

```bash
docker-compose -f docker-compose.prod.yml up --build -d
```

This builds the Docker image locally from the repo source — there is no pre-built image to pull. The `-d` flag runs it in the background.

**Development mode** (for testing/setup):

```bash
docker-compose up
```

### 6. Register Scanners in the Admin UI

After the app starts, open the Admin dashboard and register each scanner. The app auto-generates the internal watch path (`/app/data/scans/<name>/incoming`) based on the scanner name you enter. The name must match the folder you created in step 4 (e.g., name "scanner1" maps to `data/scans/scanner1/incoming`).

### 7. Access URLs

Once running, all access is via the laptop's IP address on port **3000**. Find your LAN IP with `ipconfig` (look for the WiFi adapter's IPv4 address).

| URL | Who Uses It | Auth |
|-----|-------------|------|
| `http://<laptop-ip>:3000/admin` | Admin — election setup, ballot generation, exports | Admin PIN |
| `http://<laptop-ip>:3000/admin/elections/:id/races/:raceId/rounds/:roundId` | Admin/Judge — round management, confirmation | Admin/Judge PIN |
| `http://<laptop-ip>:3000/scan/:roundId` | Tally Operators — QR phone scanning (share link) | None |
| `http://<laptop-ip>:3000/public/:electionId` | Public dashboard — TV display or mobile phones | None |
| `http://<laptop-ip>:3000/public/:electionId?mode=tv` | TV display mode (full-screen, auto-updating) | None |
| `http://<laptop-ip>:3000/login` | Role login page | PIN |

Replace `:electionId` and `:roundId` with actual IDs from the admin dashboard.

### 8. Quick Checklist

- [ ] Docker Desktop installed and running
- [ ] Scanner drivers installed (if using ADF scanners)
- [ ] `.env` file configured with custom PINs
- [ ] `data/scans/<scanner>/incoming` folders created for each scanner
- [ ] Physical scanners output set to matching `incoming` folders (JPEG format)
- [ ] `docker-compose -f docker-compose.prod.yml up --build -d` ran successfully
- [ ] Scanners registered in admin UI (names match folder names)
- [ ] Verified admin dashboard loads at `http://<laptop-ip>:3000/admin`

## Troubleshooting

**Containers won't start**
- Ensure Docker Desktop is running
- Check ports 3000 and 5432 are not in use: `docker ps`
- View logs: `docker-compose logs app`

**Database connection errors**
- Wait for the health check — the app container waits for PostgreSQL to be ready
- Check DATABASE_URL in your .env matches the docker-compose environment

**Camera not working in scanner**
- Ensure you're accessing via HTTPS or localhost (browser security requirement)
- On the LAN, some browsers require HTTPS for camera access — try Chrome

**Can't login**
- Check your PIN values in .env match what you're entering
- In development, default PINs are: admin=1234, judge=5678, chair=9012

**Sample election not showing**
- The sample election is seeded on first startup only
- To re-seed: stop containers, remove the database volume (`docker-compose down -v`), restart
