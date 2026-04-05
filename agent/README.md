# BallotTrack Station Agent

Lightweight agent that runs on each scanning station laptop. Watches a local folder for scanned ballot images and uploads them to the BallotTrack server.

## Setup

1. Install [Node.js](https://nodejs.org/) (v18+) on the station laptop
2. Copy this entire `agent/` folder to the station laptop
3. Open a terminal in the agent folder and run: `npm install`
4. Edit `config.json`:
   - `serverUrl`: The BallotTrack server address (e.g., `http://192.168.1.100:3000`)
   - `stationId`: A unique ID for this station (e.g., `station-1`, `station-2`)
   - `watchFolder`: The folder where the ScanSnap deposits images
   - `retryAttempts`: Number of upload retries on failure (default: 5)
5. Run: `node station-agent.js`
6. Open the station setup page in the browser: `http://[SERVER_IP]:3000/station-setup`

## How it works

- Watches the `watchFolder` for new image files (JPG, PNG, TIF, BMP)
- Uploads each image to the server via `POST /api/stations/:stationId/upload`
- Successfully uploaded files are moved to a `processed/` subfolder
- Failed uploads (after all retries) are moved to a `failed/` subfolder
- Files that existed before the agent started are skipped
- Files are processed sequentially (one at a time) to maintain order

## ScanSnap Configuration

Configure your ScanSnap iX2500 to:
- Save scanned images as JPEG to the `watchFolder` path
- Enable "blank page removal" (we process each page individually)
- Set resolution to 300 DPI for optimal OMR accuracy
