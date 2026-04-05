const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const db = require('../db');
const { findQRInImage, processScannedBallot } = require('../services/omrService');

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
 * Load the ballot-spec.json for a given round.
 */
function loadBallotSpec(electionId, roundId) {
  const specPath = path.join(UPLOADS_BASE, 'elections', String(electionId), 'rounds', String(roundId), 'ballot-spec.json');
  console.log(`[ScanWatcher] Loading ballot spec: ${specPath}`);
  if (!fs.existsSync(specPath)) {
    console.log(`[ScanWatcher] ballot-spec.json NOT FOUND at ${specPath}`);
    return null;
  }
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  console.log(`[ScanWatcher] Loaded ballot spec: ${spec.candidates.length} candidates, size: ${spec.ballot_size}`);
  return spec;
}

/**
 * Find the active pass for a round, or create one.
 */
async function getOrCreateActivePass(roundId) {
  const { rows: [existing] } = await db.query(
    "SELECT * FROM passes WHERE round_id = $1 AND status = 'active' ORDER BY pass_number DESC LIMIT 1",
    [roundId]
  );
  if (existing) {
    console.log(`[ScanWatcher] Using existing pass ${existing.pass_number} for round ${roundId}`);
    return existing;
  }

  // Auto-create a pass
  const { rows: [{ max }] } = await db.query(
    "SELECT COALESCE(MAX(pass_number), 0) as max FROM passes WHERE round_id = $1 AND status != 'deleted'",
    [roundId]
  );

  await db.query("UPDATE rounds SET status = 'tallying' WHERE id = $1 AND status IN ('pending_needs_action', 'ready')", [roundId]);

  const { rows: [pass] } = await db.query(
    'INSERT INTO passes (round_id, pass_number) VALUES ($1, $2) RETURNING *',
    [roundId, max + 1]
  );
  console.log(`[ScanWatcher] Auto-created pass ${pass.pass_number} for round ${roundId}`);
  return pass;
}

/**
 * Process a single scanned ballot image.
 * Tries to decode QR, run OMR, and record result.
 */
async function processSingleBallot(filePath, scannerId, io) {
  console.log(`[ScanWatcher] Processing ballot: ${path.basename(filePath)}`);

  const scanner = await db.query('SELECT * FROM scanners WHERE id = $1', [scannerId]);
  if (!scanner.rows[0]) {
    console.log(`[ScanWatcher] Scanner ${scannerId} not found in database, skipping`);
    return;
  }
  const scannerRow = scanner.rows[0];

  // Read image and try QR decode
  let frontBuffer;
  try {
    frontBuffer = fs.readFileSync(filePath);
  } catch (err) {
    console.error(`[ScanWatcher] Error reading file ${filePath}:`, err.message);
    return;
  }

  console.log(`[ScanWatcher] Checking for QR in: ${path.basename(filePath)}`);
  const qrResult = await findQRInImage(frontBuffer);
  console.log(`[ScanWatcher] QR decode result for ${path.basename(filePath)}: ${qrResult ? JSON.stringify(qrResult.qrData) : 'NOT FOUND'}`);

  if (!qrResult || !qrResult.qrData) {
    console.log(`\x1b[31m[ScanWatcher] ✗ ERROR — No QR found in ${path.basename(filePath)}\x1b[0m`);
    moveFile(filePath, path.join(SCAN_BASE, 'errors'), `noqr-${Date.now()}-${path.basename(filePath)}`);
    if (io) io.emit('scan:error', { reason: 'qr_not_found', scanner_id: scannerId, scanner_name: scannerRow.name });
    return;
  }

  // QR encodes only the serial number as a plain string
  const serialNumber = typeof qrResult.qrData === 'string' ? qrResult.qrData.trim() : null;
  if (!serialNumber || serialNumber.length < 8) {
    console.log(`\x1b[31m[ScanWatcher] ✗ ERROR — ${path.basename(filePath)}: QR data invalid "${qrResult.qrData}"\x1b[0m`);
    moveFile(filePath, path.join(SCAN_BASE, 'errors'), `badqr-${Date.now()}-${path.basename(filePath)}`);
    if (io) io.emit('scan:error', { reason: 'invalid_qr', scanner_id: scannerId });
    return;
  }

  console.log(`[ScanWatcher] QR decoded — SN: ${serialNumber}`);

  // Look up round and race from the database by serial number
  const { rows: [ballotInfo] } = await db.query(
    `SELECT bs.*, r.race_id, r.id as round_id, rc.election_id
     FROM ballot_serials bs
     JOIN rounds r ON bs.round_id = r.id
     JOIN races rc ON r.race_id = rc.id
     WHERE bs.serial_number = $1`,
    [serialNumber]
  );

  if (!ballotInfo) {
    console.log(`\x1b[31m[ScanWatcher] ✗ ERROR — ${serialNumber}: SN not found in database\x1b[0m`);
    moveFile(filePath, path.join(SCAN_BASE, 'errors'), `invalid-${serialNumber}-${path.basename(filePath)}`);
    if (io) io.emit('scan:error', { reason: 'invalid_sn', serial_number: serialNumber, scanner_id: scannerId });
    return;
  }

  const roundId = ballotInfo.round_id;
  const raceId = ballotInfo.race_id;
  const electionId = ballotInfo.election_id;
  console.log(`[ScanWatcher] DB lookup — SN: ${serialNumber}, round: ${roundId}, race: ${raceId}, election: ${electionId}`);

  // Check for duplicate
  const pass = await getOrCreateActivePass(roundId);
  const { rows: [existingScan] } = await db.query(
    'SELECT id FROM scans WHERE pass_id = $1 AND ballot_serial_id = $2',
    [pass.id, ballotInfo.id]
  );

  if (existingScan) {
    console.log(`\x1b[31m[ScanWatcher] ✗ ERROR — ${serialNumber}: Duplicate in pass ${pass.pass_number}\x1b[0m`);
    moveFile(filePath, path.join(SCAN_BASE, 'errors'), `dup-${serialNumber}-${path.basename(filePath)}`);
    if (io) io.emit('scan:duplicate', { serial_number: serialNumber, scanner_id: scannerId });
    return;
  }

  // Load ballot spec for OMR
  const ballotSpec = loadBallotSpec(electionId, roundId);

  if (!ballotSpec) {
    console.log(`\x1b[33m[ScanWatcher] ⚠ FLAGGED — ${serialNumber}: No ballot-spec.json for round ${roundId}\x1b[0m`);
    await db.query(
      `INSERT INTO reviewed_ballots (round_id, pass_id, original_serial_id, scanner_id, flag_reason, image_path)
       VALUES ($1, $2, $3, $4, 'uncertain', $5)`,
      [roundId, pass.id, ballotInfo.id, scannerId, filePath]
    );
    if (io) io.emit('scan:review_needed', { serial_number: serialNumber, reason: 'no_spec', scanner_id: scannerId });
    return;
  }

  // Run OMR
  console.log(`[ScanWatcher] Running OMR analysis on ${serialNumber}...`);
  const omrResult = await processScannedBallot(frontBuffer, ballotSpec);
  console.log(`[ScanWatcher] OMR result: vote=${omrResult.detected_vote}, confidence=${omrResult.confidence}, flag=${omrResult.flag_reason || 'none'}`);
  console.log(`[ScanWatcher] OMR candidate scores: ${JSON.stringify(omrResult.candidates.map(c => ({ name: c.name, fill: c.fill_ratio, marked: c.is_marked })))}`);

  // Determine destination folder
  const { rows: [roundRow] } = await db.query('SELECT round_number FROM rounds WHERE id = $1', [roundId]);
  const { rows: [race] } = await db.query('SELECT * FROM races WHERE id = $1', [raceId]);
  const destBase = path.join(SCAN_BASE, 'processed',
    String(electionId), race.name.toLowerCase().replace(/\s+/g, '-'),
    `round-${roundRow.round_number}`
  );

  if (omrResult.flag_reason) {
    // Flagged ballot — needs manual review
    const flaggedPath = moveFile(filePath, path.join(SCAN_BASE, 'flagged'),
      `${serialNumber}-${omrResult.flag_reason}-${Date.now()}.jpg`);

    await db.query(
      `INSERT INTO reviewed_ballots (round_id, pass_id, original_serial_id, scanner_id, flag_reason, image_path, omr_scores)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [roundId, pass.id, ballotInfo.id, scannerId, omrResult.flag_reason, flaggedPath,
       JSON.stringify(omrResult.candidates)]
    );

    console.log(`\x1b[33m[ScanWatcher] ⚠ FLAGGED — ${serialNumber} (${omrResult.flag_reason})\x1b[0m`);
    if (io) io.emit('scan:review_needed', {
      serial_number: serialNumber,
      reason: omrResult.flag_reason,
      scanner_id: scannerId,
      scanner_name: scannerRow.name,
      candidates: omrResult.candidates,
    });
  } else {
    // Clear vote — record it
    const processedPath = moveFile(filePath, destBase, `${serialNumber}.jpg`);

    await db.query(
      `INSERT INTO scans (pass_id, ballot_serial_id, candidate_id, ballot_box_id, scanner_id, scanned_by, image_path, omr_confidence, omr_method)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'auto')`,
      [pass.id, ballotInfo.id, omrResult.detected_vote, scannerRow.current_box_id || null,
       scannerId, `ADF:${scannerRow.name}`, processedPath, omrResult.confidence]
    );

    await db.query("UPDATE ballot_serials SET status = 'counted' WHERE id = $1", [ballotInfo.id]);

    const { rows: [{ count }] } = await db.query(
      'SELECT COUNT(*) as count FROM scans WHERE pass_id = $1', [pass.id]
    );

    const candidateName = omrResult.candidates.find(c => c.candidate_id === omrResult.detected_vote)?.name || `ID:${omrResult.detected_vote}`;
    console.log(`\x1b[32m[ScanWatcher] ✓ RECORDED — ${serialNumber} → ${candidateName} (confidence: ${(omrResult.confidence * 100).toFixed(1)}%, count: ${count})\x1b[0m`);
    if (io) io.emit('scan:recorded', {
      serial_number: serialNumber,
      candidate_id: omrResult.detected_vote,
      scanner_id: scannerId,
      scanner_name: scannerRow.name,
      pass_id: pass.id,
      count: parseInt(count),
      confidence: omrResult.confidence,
      method: 'auto',
    });
  }
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

  console.log(`[ScanWatcher] File detected: ${filePath}`);

  // Process each file individually — no duplex pairing
  enqueueProcessing(filePath, scannerId, io);
}

// Sequential processing queue per scanner (prevents concurrent DB writes)
const processingQueues = new Map();

/**
 * Enqueue a single file for sequential processing.
 */
function enqueueProcessing(filePath, scannerId, io) {
  if (!processingQueues.has(scannerId)) {
    processingQueues.set(scannerId, Promise.resolve());
  }

  processingQueues.set(scannerId, processingQueues.get(scannerId).then(async () => {
    try {
      await processSingleBallot(filePath, scannerId, io);
    } catch (err) {
      console.error(`[ScanWatcher] Error processing ${path.basename(filePath)}:`, err);
      try {
        moveFile(filePath, path.join(SCAN_BASE, 'errors'), `err-${Date.now()}-${path.basename(filePath)}`);
      } catch {}
    }
  }));
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
