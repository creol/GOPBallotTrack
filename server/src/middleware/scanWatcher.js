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

// Buffer for duplex pair detection: scannerId -> { files: [], timer }
const duplexBuffers = new Map();

const DUPLEX_WAIT_MS = 500;
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

  await db.query("UPDATE rounds SET status = 'scanning' WHERE id = $1 AND status = 'pending'", [roundId]);

  const { rows: [pass] } = await db.query(
    'INSERT INTO passes (round_id, pass_number) VALUES ($1, $2) RETURNING *',
    [roundId, max + 1]
  );
  console.log(`[ScanWatcher] Auto-created pass ${pass.pass_number} for round ${roundId}`);
  return pass;
}

/**
 * Process a pair of scanned images (duplex: front + back).
 * Identifies which is the front (has QR), processes OMR, records result.
 */
async function processDuplexPair(files, scannerId, io) {
  console.log(`[ScanWatcher] Processing ballot image(s): ${files.map(f => path.basename(f)).join(', ')}`);

  const scanner = await db.query('SELECT * FROM scanners WHERE id = $1', [scannerId]);
  if (!scanner.rows[0]) {
    console.log(`[ScanWatcher] Scanner ${scannerId} not found in database, skipping`);
    return;
  }
  const scannerRow = scanner.rows[0];

  let frontBuffer = null;
  let frontPath = null;
  let backPath = null;

  // Try each image for QR code
  for (const filePath of files) {
    try {
      console.log(`[ScanWatcher] Checking for QR in: ${path.basename(filePath)}`);
      const buf = fs.readFileSync(filePath);
      const qrResult = await findQRInImage(buf);
      console.log(`[ScanWatcher] QR decode result for ${path.basename(filePath)}: ${qrResult ? JSON.stringify(qrResult.qrData) : 'NOT FOUND'}`);
      if (qrResult && qrResult.qrData) {
        frontBuffer = buf;
        frontPath = filePath;
      } else if (!backPath) {
        backPath = filePath;
      }
    } catch (err) {
      console.error(`[ScanWatcher] Error reading scan file ${filePath}:`, err.message);
    }
  }

  // If no QR found in any image
  if (!frontBuffer) {
    console.log(`[ScanWatcher] Final outcome: ERROR — No QR found in any image from scanner ${scannerRow.name}`);
    for (const f of files) {
      moveFile(f, path.join(SCAN_BASE, 'errors'), `noqr-${Date.now()}-${path.basename(f)}`);
    }
    if (io) io.emit('scan:error', { reason: 'qr_not_found', scanner_id: scannerId, scanner_name: scannerRow.name });
    return;
  }

  console.log(`[ScanWatcher] Front image identified: ${path.basename(frontPath)}`);

  // Discard the back image (move to processed but don't analyze)
  if (backPath && backPath !== frontPath) {
    console.log(`[ScanWatcher] Back image discarded: ${path.basename(backPath)}`);
    moveFile(backPath, path.join(SCAN_BASE, 'processed', 'backs'), `back-${Date.now()}-${path.basename(backPath)}`);
  }

  // Get QR data to find the round
  const qrResult = await findQRInImage(frontBuffer);
  const qrData = typeof qrResult.qrData === 'object' ? qrResult.qrData : null;

  if (!qrData || !qrData.sn || !qrData.round_id || !qrData.race_id) {
    console.log(`[ScanWatcher] Final outcome: ERROR — QR data invalid: ${JSON.stringify(qrResult.qrData)}`);
    moveFile(frontPath, path.join(SCAN_BASE, 'errors'), `badqr-${Date.now()}-${path.basename(frontPath)}`);
    if (io) io.emit('scan:error', { reason: 'invalid_qr', scanner_id: scannerId });
    return;
  }

  const { sn: serialNumber, round_id: roundId, race_id: raceId } = qrData;
  console.log(`[ScanWatcher] QR decoded — SN: ${serialNumber}, round: ${roundId}, race: ${raceId}`);

  // Validate the serial number exists
  const { rows: [ballotSerial] } = await db.query(
    'SELECT * FROM ballot_serials WHERE serial_number = $1 AND round_id = $2',
    [serialNumber, roundId]
  );

  if (!ballotSerial) {
    console.log(`[ScanWatcher] Final outcome: ERROR — Invalid SN: ${serialNumber} for round ${roundId}`);
    moveFile(frontPath, path.join(SCAN_BASE, 'errors'), `invalid-${serialNumber}-${path.basename(frontPath)}`);
    if (io) io.emit('scan:error', { reason: 'invalid_sn', serial_number: serialNumber, scanner_id: scannerId });
    return;
  }

  // Check for duplicate
  const pass = await getOrCreateActivePass(roundId);
  const { rows: [existingScan] } = await db.query(
    'SELECT id FROM scans WHERE pass_id = $1 AND ballot_serial_id = $2',
    [pass.id, ballotSerial.id]
  );

  if (existingScan) {
    console.log(`[ScanWatcher] Final outcome: ERROR — Duplicate SN: ${serialNumber} in pass ${pass.pass_number}`);
    moveFile(frontPath, path.join(SCAN_BASE, 'errors'), `dup-${serialNumber}-${path.basename(frontPath)}`);
    if (io) io.emit('scan:duplicate', { serial_number: serialNumber, scanner_id: scannerId });
    return;
  }

  // Load ballot spec for OMR
  const { rows: [race] } = await db.query('SELECT * FROM races WHERE id = $1', [raceId]);
  const ballotSpec = loadBallotSpec(race.election_id, roundId);

  if (!ballotSpec) {
    console.log(`[ScanWatcher] Final outcome: FLAGGED — No ballot-spec.json for round ${roundId}, flagging for manual review`);
    await db.query(
      `INSERT INTO flagged_ballots (round_id, pass_id, ballot_serial_id, scanner_id, flag_reason, image_path)
       VALUES ($1, $2, $3, $4, 'uncertain', $5)`,
      [roundId, pass.id, ballotSerial.id, scannerId, frontPath]
    );
    if (io) io.emit('scan:flagged', { serial_number: serialNumber, reason: 'no_spec', scanner_id: scannerId });
    return;
  }

  // Run OMR
  console.log(`[ScanWatcher] Running OMR analysis on ${serialNumber}...`);
  const omrResult = await processScannedBallot(frontBuffer, ballotSpec);
  console.log(`[ScanWatcher] OMR result: vote=${omrResult.detected_vote}, confidence=${omrResult.confidence}, flag=${omrResult.flag_reason || 'none'}`);
  console.log(`[ScanWatcher] OMR candidate scores: ${JSON.stringify(omrResult.candidates.map(c => ({ name: c.name, fill: c.fill_ratio, marked: c.is_marked })))}`);

  // Determine destination folder
  const { rows: [roundRow] } = await db.query('SELECT round_number FROM rounds WHERE id = $1', [roundId]);
  const destBase = path.join(SCAN_BASE, 'processed',
    String(race.election_id), race.name.toLowerCase().replace(/\s+/g, '-'),
    `round-${roundRow.round_number}`
  );

  if (omrResult.flag_reason) {
    // Flagged ballot — needs manual review
    const flaggedPath = moveFile(frontPath, path.join(SCAN_BASE, 'flagged'),
      `${serialNumber}-${omrResult.flag_reason}-${Date.now()}.jpg`);

    await db.query(
      `INSERT INTO flagged_ballots (round_id, pass_id, ballot_serial_id, scanner_id, flag_reason, image_path, omr_scores)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [roundId, pass.id, ballotSerial.id, scannerId, omrResult.flag_reason, flaggedPath,
       JSON.stringify(omrResult.candidates)]
    );

    console.log(`[ScanWatcher] Final outcome: FLAGGED — ${serialNumber} (${omrResult.flag_reason})`);
    if (io) io.emit('scan:flagged', {
      serial_number: serialNumber,
      reason: omrResult.flag_reason,
      scanner_id: scannerId,
      scanner_name: scannerRow.name,
      candidates: omrResult.candidates,
    });
  } else {
    // Clear vote — record it
    const processedPath = moveFile(frontPath, destBase, `${serialNumber}.jpg`);

    await db.query(
      `INSERT INTO scans (pass_id, ballot_serial_id, candidate_id, scanner_id, scanned_by, image_path, omr_confidence, omr_method)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'auto')`,
      [pass.id, ballotSerial.id, omrResult.detected_vote, scannerId, `ADF:${scannerRow.name}`,
       processedPath, omrResult.confidence]
    );

    await db.query("UPDATE ballot_serials SET status = 'counted' WHERE id = $1", [ballotSerial.id]);

    const { rows: [{ count }] } = await db.query(
      'SELECT COUNT(*) as count FROM scans WHERE pass_id = $1', [pass.id]
    );

    console.log(`[ScanWatcher] Final outcome: RECORDED — ${serialNumber} -> candidate ${omrResult.detected_vote} (confidence: ${omrResult.confidence}, count: ${count})`);
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

/**
 * Handle a new file appearing in a scanner's watch folder.
 * Buffers files for DUPLEX_WAIT_MS to detect front/back pairs.
 */
function onNewFile(filePath, scannerId, io) {
  if (!SUPPORTED_EXT.test(filePath)) {
    console.log(`[ScanWatcher] Ignoring non-image file: ${filePath}`);
    return;
  }

  console.log(`[ScanWatcher] File detected: ${filePath}`);

  const key = scannerId;
  if (!duplexBuffers.has(key)) {
    duplexBuffers.set(key, { files: [], timer: null });
  }

  const buf = duplexBuffers.get(key);
  buf.files.push(filePath);

  // Reset the timer — wait for the duplex pair
  if (buf.timer) clearTimeout(buf.timer);
  buf.timer = setTimeout(async () => {
    const files = [...buf.files];
    buf.files = [];
    buf.timer = null;

    console.log(`[ScanWatcher] Processing batch of ${files.length} file(s) from scanner ${scannerId}`);

    try {
      await processDuplexPair(files, scannerId, io);
    } catch (err) {
      console.error(`[ScanWatcher] Error processing files from scanner ${scannerId}:`, err);
      for (const f of files) {
        try {
          moveFile(f, path.join(SCAN_BASE, 'errors'), `err-${Date.now()}-${path.basename(f)}`);
        } catch {}
      }
    }
  }, DUPLEX_WAIT_MS);
}

/**
 * Start a watcher for a single scanner.
 */
function startWatcher(scanner, io) {
  // Path is stored as container path (e.g. /app/data/scans/scanner1/incoming)
  const watchPath = scanner.watch_folder_path;

  // Create the incoming folder if it doesn't exist
  fs.mkdirSync(watchPath, { recursive: true });

  console.log(`[ScanWatcher] Starting watcher for scanner: ${scanner.name} at path: ${watchPath}`);

  const watcher = chokidar.watch(watchPath, {
    ignored: /(^|[\/\\])\../, // ignore dotfiles
    persistent: true,
    ignoreInitial: true,
    usePolling: true, // required for some Windows setups / network drives
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
