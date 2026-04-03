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
