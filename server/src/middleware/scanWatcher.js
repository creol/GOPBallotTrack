const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');
const db = require('../db');

// Fixed container paths — mapped via docker volume mount ./data/scans:/app/data/scans
const SCAN_BASE = '/app/data/scans';
const UPLOADS_BASE = '/app/uploads';

// Track active watchers so we can restart them
const activeWatchers = new Map();

const SUPPORTED_EXT = /\.(jpg|jpeg|png|tif|tiff|bmp)$/i;

/**
 * Ensure folder structure exists.
 */
function ensureFolders() {
  for (const sub of ['processed', 'flagged', 'errors']) {
    const dir = path.join(SCAN_BASE, sub);
    fs.mkdirSync(dir, { recursive: true });
    console.log(`[ScanWatcher] Ensured folder: ${dir}`);
  }
}

/**
 * Move a file to a destination folder, creating dirs as needed.
 * Uses copy+delete as a fallback for cross-drive moves on Windows.
 * Returns the new path.
 */
function moveFile(srcPath, destDir, newName) {
  fs.mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, newName || path.basename(srcPath));
  try {
    fs.renameSync(srcPath, destPath);
  } catch (err) {
    // rename fails across drives on Windows — fall back to copy+delete
    if (err.code === 'EXDEV') {
      fs.copyFileSync(srcPath, destPath);
      fs.unlinkSync(srcPath);
    } else {
      throw err;
    }
  }
  console.log(`[ScanWatcher] Moved: ${srcPath} -> ${destPath}`);
  return destPath;
}

/**
 * Process a single scanned ballot image.
 * Delegates to scanProcessingService for QR decode, OMR, and DB writes.
 */
async function processSingleBallot(filePath, scannerId, io) {
  console.log(`[ScanWatcher] Processing ballot: ${path.basename(filePath)}`);

  const { processBallot, recordScanUpload } = require('../services/scanProcessingService');

  let imageBuffer;
  try {
    imageBuffer = fs.readFileSync(filePath);
  } catch (err) {
    console.error(`[ScanWatcher] Error reading file ${filePath}:`, err.message);
    return;
  }

  const stationId = `scanner-${scannerId}`;
  const result = await processBallot({
    imageBuffer,
    filePath,
    stationId,
    scannerId,
    io,
  });

  // Track every upload regardless of outcome. Round is looked up inside
  // recordScanUpload from the result's serial/pass if needed — here we pass
  // null because the watcher has no pre-assigned round.
  const resolvedRoundId = result?.round_id || null;
  await recordScanUpload({ stationId, roundId: resolvedRoundId, result });

  if (result.success) {
    if (result.flagged) {
      console.log(`\x1b[33m[ScanWatcher] ⚠ FLAGGED — ${result.serial_number} (${result.flag_reason})\x1b[0m`);
    } else {
      console.log(`\x1b[32m[ScanWatcher] ✓ RECORDED — ${result.serial_number} → ${result.candidate} (${(result.confidence * 100).toFixed(1)}%, count: ${result.count})\x1b[0m`);
    }
    // Move file to processed
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
  } else {
    console.log(`\x1b[31m[ScanWatcher] ✗ ${result.error || 'Processing failed'}\x1b[0m`);
    const errDir = path.join(SCAN_BASE, 'errors');
    fs.mkdirSync(errDir, { recursive: true });
    try { moveFile(filePath, errDir, `err-${Date.now()}-${path.basename(filePath)}`); } catch {}
  }
  return;
}

// Track files that existed before watcher started (skip them)
const existingFiles = new Set();

/**
 * Handle a new file appearing in a scanner's watch folder.
 * Buffers files for DUPLEX_WAIT_MS to collect a duplex pair (max 2 files).
 * If more arrive, flushes the current pair and starts a new buffer.
 */
function onNewFile(filePath, scannerId, io) {
  if (!SUPPORTED_EXT.test(filePath)) {
    console.log(`[ScanWatcher] Ignoring non-image file: ${filePath}`);
    return;
  }

  // Skip files that existed before watcher started
  if (existingFiles.has(filePath)) {
    console.log(`[ScanWatcher] Skipping pre-existing file: ${path.basename(filePath)}`);
    existingFiles.delete(filePath);
    return;
  }

  console.log(`[ScanWatcher] File detected: ${path.basename(filePath)} (active=${activeCount}, pending=${pendingQueue.length})`);

  // Process each file individually
  enqueueProcessing(filePath, scannerId, io);
}

// Sequential processing queue per scanner (prevents concurrent DB writes)
const processingQueues = new Map();

// Concurrency limiter — process up to N ballots in parallel
const MAX_CONCURRENT = 4;
let activeCount = 0;
const pendingQueue = [];

function enqueueProcessing(filePath, scannerId, io) {
  const task = async () => {
    activeCount++;
    try {
      await processSingleBallot(filePath, scannerId, io);
    } catch (err) {
      console.error(`[ScanWatcher] Error processing ${path.basename(filePath)}:`, err);
      try {
        moveFile(filePath, path.join(SCAN_BASE, 'errors'), `err-${Date.now()}-${path.basename(filePath)}`);
      } catch {}
    } finally {
      activeCount--;
      if (pendingQueue.length > 0) {
        const next = pendingQueue.shift();
        next();
      }
    }
  };

  if (activeCount < MAX_CONCURRENT) {
    task();
  } else {
    pendingQueue.push(task);
  }
}

/**
 * Snapshot existing files in a folder so we can skip them.
 */
function snapshotExistingFiles(watchPath) {
  try {
    const files = fs.readdirSync(watchPath);
    for (const f of files) {
      if (SUPPORTED_EXT.test(f)) {
        const fullPath = path.join(watchPath, f);
        existingFiles.add(fullPath);
      }
    }
    if (files.length > 0) {
      console.log(`[ScanWatcher] Found ${existingFiles.size} pre-existing file(s) in ${watchPath} — will skip them`);
    }
  } catch {}
}

/**
 * Start a watcher for a single scanner.
 */
function startWatcher(scanner, io) {
  // Path is stored as container path (e.g. /app/data/scans/scanner1/incoming)
  const watchPath = scanner.watch_folder_path;

  // Create the incoming folder if it doesn't exist
  fs.mkdirSync(watchPath, { recursive: true });

  // Snapshot existing files so we don't process them on startup
  snapshotExistingFiles(watchPath);

  console.log(`[ScanWatcher] Starting watcher for scanner: ${scanner.name} at path: ${watchPath}`);

  const watcher = chokidar.watch(watchPath, {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: false, // we handle skip via existingFiles set
    usePolling: true, // required for Docker volume mounts and some Windows setups
    interval: 500,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100,
    },
  });

  watcher.on('add', (filePath) => {
    onNewFile(filePath, scanner.id, io);
  });

  watcher.on('error', (err) => {
    console.error(`[ScanWatcher] Watcher error for ${scanner.name}:`, err.message);
  });

  watcher.on('ready', () => {
    console.log(`[ScanWatcher] Watcher ready for scanner: ${scanner.name} — monitoring ${watchPath}`);
  });

  activeWatchers.set(scanner.id, watcher);
}

/**
 * Start watchers for all active scanners. Called from index.js after server starts.
 */
async function startWatchers(io) {
  ensureFolders();

  try {
    const { rows: scanners } = await db.query(
      "SELECT * FROM scanners WHERE status = 'active'"
    );

    if (scanners.length === 0) {
      console.log('[ScanWatcher] No active scanners configured.');
      return;
    }

    console.log(`[ScanWatcher] Found ${scanners.length} active scanner(s) in database:`);
    for (const scanner of scanners) {
      console.log(`[ScanWatcher]   - ${scanner.name}: ${scanner.watch_folder_path}`);
      startWatcher(scanner, io);
    }

    console.log(`[ScanWatcher] Started ${scanners.length} watcher(s).`);
  } catch (err) {
    console.error('[ScanWatcher] Failed to start watchers:', err.message);
  }
}

/**
 * Stop all watchers (for cleanup/restart).
 */
async function stopWatchers() {
  for (const [id, watcher] of activeWatchers) {
    await watcher.close();
  }
  activeWatchers.clear();
  console.log('[ScanWatcher] All watchers stopped.');
}

/**
 * Restart watchers (e.g., after adding/removing a scanner).
 */
async function restartWatchers(io) {
  await stopWatchers();
  await startWatchers(io);
}

module.exports = { startWatchers, stopWatchers, restartWatchers };
