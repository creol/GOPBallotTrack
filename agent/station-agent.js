#!/usr/bin/env node
/**
 * BallotTrack Station Agent
 *
 * Watches a local folder for scanned ballot images and uploads them
 * to the BallotTrack server. Runs on each scanning station laptop.
 *
 * Usage: node station-agent.js
 * Config: edit config.json in the same directory
 */

const chokidar = require('chokidar');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

// Load config
const configPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
  console.error('ERROR: config.json not found. Copy config.json.example and edit it.');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const { serverUrl, stationId, watchFolder, retryAttempts = 5 } = config;

if (!serverUrl || !stationId || !watchFolder) {
  console.error('ERROR: config.json must have serverUrl, stationId, and watchFolder');
  process.exit(1);
}

// Ensure processed/failed folders exist
const processedDir = path.join(watchFolder, '..', 'processed');
const failedDir = path.join(watchFolder, '..', 'failed');
fs.mkdirSync(processedDir, { recursive: true });
fs.mkdirSync(failedDir, { recursive: true });

const EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.bmp']);

// --- Log buffer: collects logs and sends to server periodically ---
let logBuffer = [];
let currentRoundId = null;
const LOG_FLUSH_INTERVAL = 5000; // flush every 5 seconds

function timestamp() {
  return new Date().toISOString().replace('T', ' ').split('.')[0];
}

function bufferLog(level, msg, serialNumber) {
  logBuffer.push({
    level,
    message: msg,
    serialNumber: serialNumber || null,
    roundId: currentRoundId,
    timestamp: new Date().toISOString(),
  });
}

async function flushLogs() {
  if (logBuffer.length === 0) return;
  const batch = logBuffer.splice(0, logBuffer.length);
  try {
    await axios.post(`${serverUrl}/api/stations/${stationId}/logs`, { logs: batch }, { timeout: 5000 });
  } catch {
    // Put them back if send fails — they'll retry next flush
    logBuffer.unshift(...batch);
    // Cap buffer at 1000 to prevent memory leaks
    if (logBuffer.length > 1000) logBuffer = logBuffer.slice(-500);
  }
}

setInterval(flushLogs, LOG_FLUSH_INTERVAL);

function log(msg, serialNumber) {
  console.log(`[${timestamp()}] ${msg}`);
  bufferLog('info', msg, serialNumber);
}

function logError(msg, serialNumber) {
  console.error(`[${timestamp()}] ERROR: ${msg}`);
  bufferLog('error', msg, serialNumber);
}

function logSuccess(msg, serialNumber) {
  console.log(`[${timestamp()}] \x1b[32m${msg}\x1b[0m`);
  bufferLog('success', msg, serialNumber);
}

/**
 * Check if station is assigned to a round; auto-assign if exactly one round is active.
 */
async function ensureAssignment() {
  try {
    const { data: assignment } = await axios.get(`${serverUrl}/api/stations/${stationId}/assignment`);
    if (assignment.assigned) {
      currentRoundId = assignment.roundId;
      logSuccess(`Assigned to round ${assignment.roundId}`);
      return assignment.roundId;
    }

    log('Not assigned to a round — checking for active rounds...');
    const { data: rounds } = await axios.get(`${serverUrl}/api/stations/active-rounds`);

    if (rounds.length === 0) {
      logError('No rounds are currently in tallying status.');
      log(`Assign manually at: ${serverUrl}/station-setup`);
      return null;
    }

    if (rounds.length === 1) {
      const round = rounds[0];
      await axios.post(`${serverUrl}/api/stations/${stationId}/assign`, { roundId: round.round_id });
      currentRoundId = round.round_id;
      logSuccess(`Auto-assigned to: ${round.race_name} — Round ${round.round_number} (${round.paper_color})`);
      return round.round_id;
    }

    logError(`Found ${rounds.length} active rounds — cannot auto-assign.`);
    log(`Assign manually at: ${serverUrl}/station-setup`);
    return null;
  } catch (err) {
    logError(`Assignment check failed: ${err.message}`);
    return null;
  }
}

/**
 * Upload a file to the server with retry logic.
 */
async function uploadFile(filePath) {
  const filename = path.basename(filePath);
  log(`New file detected: ${filename}`);

  for (let attempt = 1; attempt <= retryAttempts; attempt++) {
    try {
      const form = new FormData();
      form.append('image', fs.createReadStream(filePath), filename);

      const url = `${serverUrl}/api/stations/${stationId}/upload`;
      const response = await axios.post(url, form, {
        headers: form.getHeaders(),
        timeout: 30000,
        maxContentLength: 50 * 1024 * 1024, // 50MB
      });

      const sn = response.data.serial_number || null;
      logSuccess(`Uploaded ${filename} — ${response.data.message || 'OK'}`, sn);

      // Move to processed folder
      const dest = path.join(processedDir, `${Date.now()}-${filename}`);
      fs.renameSync(filePath, dest);
      return;
    } catch (err) {
      const errMsg = err.response?.data?.error || err.message;
      const status = err.response?.status;

      // Don't retry on application errors (4xx or 500 with message) — only retry on network/timeout
      const isAppError = status && (status >= 400 && status < 500) || (status === 500 && err.response?.data?.error);
      if (isAppError) {
        logError(`Upload rejected: ${errMsg} (${status}) — not retrying`);
        // Move to failed folder so it doesn't sit in the watch folder
        try {
          const dest = path.join(failedDir, `${Date.now()}-${filename}`);
          fs.renameSync(filePath, dest);
          log(`Moved to failed: ${dest}`);
        } catch (moveErr) {
          logError(`Could not move failed file: ${moveErr.message}`);
        }
        return;
      } else if (attempt < retryAttempts) {
        const delay = Math.pow(2, attempt) * 1000;
        logError(`Upload failed (attempt ${attempt}/${retryAttempts}): ${errMsg} — retrying in ${delay / 1000}s`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      } else {
        logError(`Upload FAILED after ${retryAttempts} attempts: ${errMsg}`);
        // Move to failed folder
        try {
          const dest = path.join(failedDir, `${Date.now()}-${filename}`);
          fs.renameSync(filePath, dest);
          log(`Moved to failed: ${dest}`);
        } catch (moveErr) {
          logError(`Could not move failed file: ${moveErr.message}`);
        }
      }
    }
  }
}

// Processing queue to handle files sequentially
let processing = Promise.resolve();

function queueFile(filePath) {
  processing = processing.then(() => uploadFile(filePath)).catch(() => {});
}

// Start watching
log('='.repeat(60));
log(`BallotTrack Station Agent`);
log(`Station ID:   ${stationId}`);
log(`Server:       ${serverUrl}`);
log(`Watch folder: ${watchFolder}`);
log(`Processed:    ${processedDir}`);
log(`Failed:       ${failedDir}`);
log('='.repeat(60));

if (!fs.existsSync(watchFolder)) {
  log(`Watch folder does not exist, creating: ${watchFolder}`);
  fs.mkdirSync(watchFolder, { recursive: true });
}

// Test server connection, then auto-assign to a round if possible
axios.get(`${serverUrl}/api/health`)
  .then(res => {
    logSuccess(`Server connection OK: ${res.data.status}`);
    return ensureAssignment();
  })
  .then(roundId => {
    if (roundId) {
      log(`Uploads will be processed for round ${roundId}`);
      log(`Scanner page: ${serverUrl}/scan/${roundId}`);
    } else {
      log('WARNING: Not assigned — uploads will fail until assigned.');
      log(`Visit: ${serverUrl}/station-setup`);
    }
  })
  .catch(err => logError(`Cannot reach server: ${err.message}`));

// Snapshot existing files to skip them
const existingFiles = new Set();
try {
  for (const f of fs.readdirSync(watchFolder)) {
    existingFiles.add(path.join(watchFolder, f));
  }
  if (existingFiles.size > 0) {
    log(`Skipping ${existingFiles.size} pre-existing file(s)`);
  }
} catch {}

const watcher = chokidar.watch(watchFolder, {
  ignored: /(^|[\/\\])\./,
  persistent: true,
  ignoreInitial: false,
  awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  usePolling: true,
  interval: 500,
});

watcher.on('add', (filePath) => {
  // Skip pre-existing files
  if (existingFiles.has(filePath)) {
    existingFiles.delete(filePath);
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!EXTENSIONS.has(ext)) return;

  queueFile(filePath);
});

watcher.on('error', (err) => logError(`Watcher error: ${err.message}`));
watcher.on('ready', () => log('Watching for new ballot images...'));

// Handle shutdown gracefully
process.on('SIGINT', async () => {
  log('Shutting down...');
  await flushLogs();
  watcher.close().then(() => process.exit(0));
});
