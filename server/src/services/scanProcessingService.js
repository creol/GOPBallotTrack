const fs = require('fs');
const path = require('path');
const db = require('../db');
const { findQRInImage, processScannedBallot } = require('./omrService');
const { writeLog } = require('./scanLogService');

const UPLOADS_BASE = path.join(__dirname, '..', '..', '..', 'uploads');
const SCAN_BASE = path.join(__dirname, '..', '..', '..', 'data', 'scans');

/**
 * Always save the image so it can be reviewed later, regardless of processing outcome.
 * Returns the saved file path.
 */
function saveImageForReview(buffer, label, filePath) {
  const flagDir = path.join(SCAN_BASE, 'flagged');
  fs.mkdirSync(flagDir, { recursive: true });
  const baseName = filePath ? path.basename(filePath, path.extname(filePath)) : 'upload';
  const savedName = `${label}-${baseName}-${Date.now()}.jpg`;
  const savedPath = path.join(flagDir, savedName);
  fs.writeFileSync(savedPath, buffer);
  return savedPath;
}

function loadBallotSpec(electionId, roundId) {
  const specPath = path.join(UPLOADS_BASE, 'elections', String(electionId), 'rounds', String(roundId), 'ballot-spec.json');
  try {
    return JSON.parse(fs.readFileSync(specPath, 'utf8'));
  } catch {
    return null;
  }
}

// Round statuses where it is safe for a scanner station to deposit ballots.
// Anything outside this set (pending_needs_action, ready, round_finalized,
// canceled) MUST reject the upload — a station should never silently
// re-open or progress a round.
const SCANNABLE_ROUND_STATUSES = new Set(['voting_open', 'voting_closed', 'tallying']);

class RoundNotScannableError extends Error {
  constructor(roundId, status) {
    super(`Round ${roundId} is not open for scanning (status=${status})`);
    this.code = 'round_not_scannable';
    this.roundId = roundId;
    this.roundStatus = status;
  }
}

async function getRoundStatus(roundId) {
  const { rows: [row] } = await db.query('SELECT status FROM rounds WHERE id = $1', [roundId]);
  return row ? row.status : null;
}

/**
 * Get or create an active pass for a round.
 *
 * Will throw RoundNotScannableError if the round is not currently in a
 * scannable status. This is the load-bearing gate that prevents a stale
 * station assignment (or a serial that happens to belong to a different
 * round, e.g. after a clone) from silently auto-opening an official
 * round and recording scans against it.
 */
async function getOrCreateActivePass(roundId) {
  const status = await getRoundStatus(roundId);
  if (!SCANNABLE_ROUND_STATUSES.has(status)) {
    throw new RoundNotScannableError(roundId, status);
  }

  const { rows: [existing] } = await db.query(
    "SELECT * FROM passes WHERE round_id = $1 AND status = 'active' ORDER BY pass_number DESC LIMIT 1",
    [roundId]
  );
  if (existing) return existing;

  const { rows: [{ max }] } = await db.query(
    "SELECT COALESCE(MAX(pass_number), 0) as max FROM passes WHERE round_id = $1 AND status != 'deleted'",
    [roundId]
  );

  const { rows: [pass] } = await db.query(
    'INSERT INTO passes (round_id, pass_number) VALUES ($1, $2) RETURNING *',
    [roundId, max + 1]
  );
  return pass;
}

/**
 * Process a scanned ballot image.
 * Can be called from file watcher (with filePath) or station upload (with imageBuffer).
 *
 * @param {Object} params
 * @param {Buffer} params.imageBuffer - The image data
 * @param {string} [params.filePath] - Original file path (for file watcher)
 * @param {string} params.stationId - Station or scanner identifier
 * @param {number} [params.roundId] - If known (station upload knows the assigned round)
 * @param {number} [params.scannerId] - DB scanner ID if applicable
 * @param {Object} [params.io] - Socket.IO server instance for WebSocket events
 * @returns {Object} { success, serial_number, message, ... }
 */
async function processBallot({ imageBuffer, filePath, stationId, roundId: assignedRoundId, scannerId, io }) {
  const source = stationId || 'unknown';
  const t0 = Date.now();
  let _logElectionId = null;
  let _logSerialNumber = null;
  const log = (msg, level = 'info') => {
    const fullMsg = `${msg} (+${Date.now() - t0}ms)`;
    console.log(`[Scan:${source}] ${fullMsg}`);
    writeLog({
      electionId: _logElectionId, source: 'server:scan', level,
      message: fullMsg, serialNumber: _logSerialNumber,
      roundId: assignedRoundId || null, stationId: source,
      metadata: { elapsed_ms: Date.now() - t0 },
    });
  };

  // Read image if buffer not provided
  let buffer = imageBuffer;
  if (!buffer && filePath) {
    try {
      buffer = fs.readFileSync(filePath);
    } catch (err) {
      return { success: false, error: `Cannot read file: ${err.message}` };
    }
  }
  if (!buffer) return { success: false, error: 'No image data' };

  // Hard gate: if the caller named a round, refuse to write anything against
  // it unless the round is currently in a scannable state. Prevents a stale
  // station assignment from auto-opening an official round.
  if (assignedRoundId) {
    const status = await getRoundStatus(assignedRoundId);
    if (!SCANNABLE_ROUND_STATUSES.has(status)) {
      const savedPath = saveImageForReview(buffer, `roundclosed-${assignedRoundId}`, filePath);
      if (filePath) { try { fs.unlinkSync(filePath); } catch {} }
      log(`ROUND NOT OPEN — round ${assignedRoundId} status=${status}; rejecting upload from ${source}`, 'warn');
      if (io) io.emit('scan:error', { reason: 'round_not_open', station: source, round_id: assignedRoundId, round_status: status });
      return {
        success: false,
        flag_reason: 'round_not_open',
        round_id: assignedRoundId,
        round_status: status,
        image_path: savedPath,
        error: `Round ${assignedRoundId} is not open for scanning (status=${status}). Reassign this station to an open round.`,
      };
    }
  }

  // QR decode
  log(`START file=${filePath ? path.basename(filePath) : 'upload'} size=${buffer.length}`);
  const qrResult = await findQRInImage(buffer);
  log(`QR decode done: ${qrResult ? qrResult.qrData : 'NOT FOUND'}`);
  if (!qrResult || !qrResult.qrData) {
    // Save the image and create a review record so it can be adjudicated
    const flagDir = path.join(SCAN_BASE, 'flagged');
    fs.mkdirSync(flagDir, { recursive: true });
    const savedName = `noqr-${Date.now()}-${filePath ? path.basename(filePath) : 'upload.jpg'}`;
    const savedPath = path.join(flagDir, savedName);
    fs.writeFileSync(savedPath, buffer);

    if (filePath) {
      try { fs.unlinkSync(filePath); } catch {}
    }

    // If we know the round (station upload), create a reviewed_ballot for adjudication
    if (assignedRoundId) {
      try {
        const pass = await getOrCreateActivePass(assignedRoundId);
        await db.query(
          `INSERT INTO reviewed_ballots (round_id, pass_id, scanner_id, station_id, flag_reason, image_path, notes)
           VALUES ($1, $2, $3, $4, 'qr_not_found', $5, $6)`,
          [assignedRoundId, pass.id, scannerId || null, source, savedPath,
           `QR code could not be decoded. Source: ${source}. Original file: ${filePath ? path.basename(filePath) : 'upload'}`]
        );
        log(`QR not found — image saved for review: ${savedName}`);
        if (io) io.emit('scan:review_needed', { reason: 'qr_not_found', station: source, image_path: savedPath });
        return {
          success: true,
          flagged: true,
          flag_reason: 'qr_not_found',
          message: `Ballot image saved for review — QR code could not be decoded`,
        };
      } catch (dbErr) {
        console.error('[Scan] Failed to create review record for QR failure:', dbErr.message);
      }
    }

    if (io) io.emit('scan:error', { reason: 'qr_not_found', station: source });
    return { success: false, error: 'No QR code found' };
  }

  const serialNumber = typeof qrResult.qrData === 'string' ? qrResult.qrData.trim() : null;
  _logSerialNumber = serialNumber;
  if (!serialNumber || serialNumber.length < 8) {
    const savedPath = saveImageForReview(buffer, 'invalidqr', filePath);
    if (assignedRoundId) {
      try {
        const pass = await getOrCreateActivePass(assignedRoundId);
        await db.query(
          `INSERT INTO reviewed_ballots (round_id, pass_id, scanner_id, station_id, flag_reason, image_path, notes)
           VALUES ($1, $2, $3, $4, 'invalid_qr', $5, $6)`,
          [assignedRoundId, pass.id, scannerId || null, source, savedPath,
           `Invalid QR data: ${qrResult.qrData}. Source: ${source}`]
        );
      } catch (dbErr) { console.error('[Scan] Failed to create review record:', dbErr.message); }
    }
    if (io) io.emit('scan:error', { reason: 'invalid_qr', station: source });
    return { success: true, flagged: true, flag_reason: 'invalid_qr', message: `Flagged: invalid QR data`, error: `Invalid QR data: ${qrResult.qrData}` };
  }

  // Look up ballot serial
  log(`DB lookup SN=${serialNumber} round=${assignedRoundId || 'any'}`);
  let ballotInfo;
  if (assignedRoundId) {
    const { rows: [info] } = await db.query(
      `SELECT bs.*, r.race_id, r.id as round_id, rc.election_id
       FROM ballot_serials bs
       JOIN rounds r ON bs.round_id = r.id
       JOIN races rc ON r.race_id = rc.id
       WHERE bs.serial_number = $1 AND bs.round_id = $2`,
      [serialNumber, assignedRoundId]
    );
    ballotInfo = info;

    // Cross-race conflict detection
    if (!ballotInfo) {
      const { rows: otherRounds } = await db.query(
        `SELECT bs.*, r.race_id, ra.name AS race_name, r.round_number
         FROM ballot_serials bs
         JOIN rounds r ON bs.round_id = r.id
         JOIN races ra ON r.race_id = ra.id
         WHERE bs.serial_number = $1
           AND r.status = 'tallying'
           AND r.id != $2`,
        [serialNumber, assignedRoundId]
      );

      if (otherRounds.length > 0) {
        const wrong = otherRounds[0];
        const savedPath = saveImageForReview(buffer, `wrongstation-${serialNumber}`, filePath);
        try {
          const pass = await getOrCreateActivePass(assignedRoundId);
          await db.query(
            `INSERT INTO reviewed_ballots (round_id, pass_id, original_serial_id, scanner_id, station_id, flag_reason, image_path, notes)
             VALUES ($1, $2, $3, $4, $5, 'wrong_station', $6, $7)`,
            [assignedRoundId, pass.id, wrong.id, scannerId || null, source, savedPath,
             `Belongs to ${wrong.race_name} Round ${wrong.round_number}. Source: ${source}`]
          );
        } catch (dbErr) { console.error('[Scan] Failed to create review record:', dbErr.message); }
        log(`WRONG STATION SN=${serialNumber} — belongs to ${wrong.race_name} Round ${wrong.round_number}`, 'warn');
        if (io) io.emit('scan:wrong_station', {
          serial_number: serialNumber,
          from_station: source,
          target_race: wrong.race_name,
          target_round: wrong.round_number,
        });
        return {
          success: true,
          flagged: true,
          type: 'wrong_station',
          message: `[Wrong Station] Ballot ${serialNumber} belongs to ${wrong.race_name} Round ${wrong.round_number}. Please scan at that race's station.`,
          targetRace: wrong.race_name,
          targetRound: wrong.round_number,
        };
      }

      // Not found in any tallying round — check if serial exists at all
      const { rows: [anyBallot] } = await db.query(
        `SELECT bs.id, bs.round_id, r.race_id, r.round_number, ra.name as race_name
         FROM ballot_serials bs
         JOIN rounds r ON bs.round_id = r.id
         JOIN races ra ON r.race_id = ra.id
         WHERE bs.serial_number = $1`,
        [serialNumber]
      );
      if (anyBallot) {
        // Exists but wrong round — flag it and save image
        const savedPath = saveImageForReview(buffer, `wronground-${serialNumber}`, filePath);
        const pass = await getOrCreateActivePass(assignedRoundId);

        // Check if same race (different round) — keep visible in confirmation UI
        const { rows: [assignedRound] } = await db.query('SELECT race_id FROM rounds WHERE id = $1', [assignedRoundId]);
        const sameRace = assignedRound && anyBallot.race_id === assignedRound.race_id;
        const noteText = sameRace
          ? `Same race (${anyBallot.race_name}), from Round ${anyBallot.round_number}. Needs admin approval to count.`
          : 'Serial not found in assigned round';

        await db.query(
          `INSERT INTO reviewed_ballots (round_id, pass_id, original_serial_id, scanner_id, station_id, flag_reason, image_path, notes)
           VALUES ($1, $2, $3, $4, $5, 'wrong_round', $6, $7)`,
          [assignedRoundId, pass.id, anyBallot.id, scannerId || null, source, savedPath, noteText]
        );

        // If same race, also create a scan record so ballot is visible in confirmation/comparison
        if (sameRace) {
          // Run OMR to detect the vote — try ballot spec from original round first, then assigned round
          const { rows: [origRace] } = await db.query(
            'SELECT rc.election_id FROM races rc JOIN rounds r ON r.race_id = rc.id WHERE r.id = $1',
            [anyBallot.round_id]
          );
          const eid = origRace?.election_id;
          const ballotSpec = (eid && loadBallotSpec(eid, anyBallot.round_id)) || (eid && loadBallotSpec(eid, assignedRoundId));
          let candidateId = null;
          let omrConf = null;
          if (ballotSpec) {
            try {
              const omrResult = await processScannedBallot(buffer, ballotSpec, qrResult);
              candidateId = omrResult.detected_vote || null;
              omrConf = omrResult.confidence;
            } catch {}
          }
          await db.query(
            `INSERT INTO scans (pass_id, ballot_serial_id, candidate_id, scanner_id, scanned_by, image_path, omr_confidence, omr_method)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'wrong_round_pending')`,
            [pass.id, anyBallot.id, candidateId, scannerId || null,
             `Station:${source}`, savedPath, omrConf]
          );
        }

        log(`WRONG ROUND SN=${serialNumber} — belongs to ${anyBallot.race_name} Round ${anyBallot.round_number}${sameRace ? ' (same race)' : ''}`, 'warn');
        if (io) io.emit('scan:review_needed', { serial_number: serialNumber, reason: 'wrong_round', station: source, same_race: sameRace });
        return {
          success: true, flagged: true, flag_reason: 'wrong_round', serial_number: serialNumber,
          same_race: sameRace,
          original_race: anyBallot.race_name,
          original_round: anyBallot.round_number,
          message: `[Wrong Round] Ballot ${serialNumber} from ${anyBallot.race_name} R${anyBallot.round_number}${sameRace ? ' — same race, needs admin approval' : ' — flagged for review'}`,
        };
      }

      // Completely unknown serial — still save the image
      const savedPath = saveImageForReview(buffer, `unknown-${serialNumber}`, filePath);
      try {
        const pass = await getOrCreateActivePass(assignedRoundId);
        await db.query(
          `INSERT INTO reviewed_ballots (round_id, pass_id, scanner_id, station_id, flag_reason, image_path, notes)
           VALUES ($1, $2, $3, $4, 'unknown_sn', $5, $6)`,
          [assignedRoundId, pass.id, scannerId || null, source, savedPath,
           `Unrecognized serial number: ${serialNumber}. Source: ${source}`]
        );
      } catch (dbErr) { console.error('[Scan] Failed to create review record:', dbErr.message); }
      log(`UNKNOWN SERIAL SN=${serialNumber} — not found in any round`, 'error');
      if (io) io.emit('scan:error', { reason: 'unknown_sn', serial_number: serialNumber, station: source });
      return { success: true, flagged: true, flag_reason: 'unknown_sn', serial_number: serialNumber, message: `[Unknown] Serial ${serialNumber} not found in any round — flagged for review`, error: 'Unrecognized serial number' };
    }
  } else {
    // No assigned round — look up globally
    const { rows: [info] } = await db.query(
      `SELECT bs.*, r.race_id, r.id as round_id, rc.election_id
       FROM ballot_serials bs
       JOIN rounds r ON bs.round_id = r.id
       JOIN races rc ON r.race_id = rc.id
       WHERE bs.serial_number = $1`,
      [serialNumber]
    );
    ballotInfo = info;
  }

  if (!ballotInfo) {
    const savedPath = saveImageForReview(buffer, `notfound-${serialNumber}`, filePath);
    if (io) io.emit('scan:error', { reason: 'invalid_sn', serial_number: serialNumber, station: source });
    return { success: true, flagged: true, flag_reason: 'invalid_sn', serial_number: serialNumber, message: `Flagged: serial ${serialNumber} not found in DB`, error: `Serial number ${serialNumber} not found`, image_path: savedPath };
  }

  // Don't reject based on serial status — ballots are scanned multiple times across passes
  // The per-pass duplicate check below handles actual duplicates within a single pass
  if (ballotInfo.status === 'spoiled' || ballotInfo.status === 'damaged') {
    const savedPath = saveImageForReview(buffer, `${ballotInfo.status}-${serialNumber}`, filePath);
    if (io) io.emit('scan:duplicate', { serial_number: serialNumber, station: source });
    return { success: true, flagged: true, flag_reason: ballotInfo.status, serial_number: serialNumber, message: `Flagged: ballot ${serialNumber} is ${ballotInfo.status}`, error: `Ballot ${serialNumber} is ${ballotInfo.status}`, image_path: savedPath };
  }

  const roundId = ballotInfo.round_id;
  const raceId = ballotInfo.race_id;
  const electionId = ballotInfo.election_id;
  _logElectionId = electionId;

  // Get or create active pass — may refuse if the round isn't open for
  // scanning. Watcher path arrives here without an upfront round gate, so
  // catch that case and return a clean failure instead of crashing.
  let pass;
  try {
    pass = await getOrCreateActivePass(roundId);
  } catch (err) {
    if (err && err.code === 'round_not_scannable') {
      const savedPath = saveImageForReview(buffer, `roundclosed-${serialNumber}`, filePath);
      log(`ROUND NOT OPEN — SN=${serialNumber} resolved to round ${err.roundId} status=${err.roundStatus}; rejecting`, 'warn');
      if (io) io.emit('scan:error', { reason: 'round_not_open', station: source, round_id: err.roundId, round_status: err.roundStatus, serial_number: serialNumber });
      return {
        success: false,
        serial_number: serialNumber,
        flag_reason: 'round_not_open',
        round_id: err.roundId,
        round_status: err.roundStatus,
        image_path: savedPath,
        error: `Ballot ${serialNumber} belongs to round ${err.roundId} (status=${err.roundStatus}) — not open for scanning.`,
      };
    }
    throw err;
  }

  // Check for duplicate in this pass
  const { rows: [existingScan] } = await db.query(
    'SELECT id FROM scans WHERE pass_id = $1 AND ballot_serial_id = $2',
    [pass.id, ballotInfo.id]
  );
  if (existingScan) {
    const savedPath = saveImageForReview(buffer, `duplicate-${serialNumber}`, filePath);
    if (io) io.emit('scan:duplicate', { serial_number: serialNumber, station: source });
    return { success: true, flagged: true, flag_reason: 'duplicate', serial_number: serialNumber, message: `Flagged: duplicate ${serialNumber} in pass ${pass.pass_number}`, error: `Duplicate in pass ${pass.pass_number}`, image_path: savedPath };
  }

  // Load ballot spec for OMR
  const ballotSpec = loadBallotSpec(electionId, roundId);

  if (!ballotSpec) {
    const savedPath = saveImageForReview(buffer, `nospec-${serialNumber}`, filePath);
    await db.query(
      `INSERT INTO reviewed_ballots (round_id, pass_id, original_serial_id, scanner_id, station_id, flag_reason, image_path)
       VALUES ($1, $2, $3, $4, $5, 'no_spec', $6)`,
      [roundId, pass.id, ballotInfo.id, scannerId || null, source, savedPath]
    );
    log(`NO SPEC SN=${serialNumber} — ballot spec not found`, 'warn');
    if (io) io.emit('scan:review_needed', { serial_number: serialNumber, reason: 'no_spec', station: source });
    return { success: true, flagged: true, flag_reason: 'no_spec', serial_number: serialNumber, message: `Flagged: ${serialNumber} no ballot spec for OMR`, error: 'No ballot spec — cannot run OMR' };
  }

  // Run OMR
  log(`OMR start for SN=${serialNumber}`);
  const omrResult = await processScannedBallot(buffer, ballotSpec, qrResult);
  log(`OMR done: vote=${omrResult.detected_vote} flag=${omrResult.flag_reason || 'none'} confidence=${omrResult.confidence}`);

  // Save the image
  const { rows: [roundRow] } = await db.query('SELECT round_number FROM rounds WHERE id = $1', [roundId]);
  const { rows: [race] } = await db.query('SELECT name FROM races WHERE id = $1', [raceId]);

  if (omrResult.flag_reason) {
    // Flagged — save to flagged folder and create review record
    const flagDir = path.join(SCAN_BASE, 'flagged');
    fs.mkdirSync(flagDir, { recursive: true });
    const flaggedPath = path.join(flagDir, `${serialNumber}-${omrResult.flag_reason}-${Date.now()}.jpg`);
    fs.writeFileSync(flaggedPath, buffer);

    await db.query(
      `INSERT INTO reviewed_ballots (round_id, pass_id, original_serial_id, scanner_id, station_id, flag_reason, image_path, omr_scores)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [roundId, pass.id, ballotInfo.id, scannerId || null, source, omrResult.flag_reason, flaggedPath,
       JSON.stringify(omrResult.candidates)]
    );

    if (io) io.emit('scan:review_needed', {
      serial_number: serialNumber,
      reason: omrResult.flag_reason,
      station: source,
      candidates: omrResult.candidates,
    });

    log(`FLAGGED SN=${serialNumber} reason=${omrResult.flag_reason}`, 'warn');
    return {
      success: true,
      flagged: true,
      serial_number: serialNumber,
      flag_reason: omrResult.flag_reason,
      race_name: race.name,
      round_number: roundRow.round_number,
      message: `[${race.name} R${roundRow.round_number}] Ballot ${serialNumber} flagged: ${omrResult.flag_reason}`,
    };
  }

  // Clear vote — save and record (include pass number so Pass 2 doesn't overwrite Pass 1)
  const destBase = path.join(SCAN_BASE, 'processed',
    String(electionId), race.name.toLowerCase().replace(/\s+/g, '-'),
    `round-${roundRow.round_number}`, `pass-${pass.pass_number}`
  );
  fs.mkdirSync(destBase, { recursive: true });
  const processedPath = path.join(destBase, `${serialNumber}.jpg`);
  fs.writeFileSync(processedPath, buffer);

  await db.query(
    `INSERT INTO scans (pass_id, ballot_serial_id, candidate_id, scanner_id, scanned_by, image_path, omr_confidence, omr_method)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'auto')`,
    [pass.id, ballotInfo.id, omrResult.detected_vote, scannerId || null,
     `Station:${source}`, processedPath, omrResult.confidence]
  );

  await db.query("UPDATE ballot_serials SET status = 'counted' WHERE id = $1", [ballotInfo.id]);

  const { rows: [{ count }] } = await db.query(
    'SELECT COUNT(*) as count FROM scans WHERE pass_id = $1', [pass.id]
  );

  const candidateName = omrResult.candidates.find(c => c.candidate_id === omrResult.detected_vote)?.name || `ID:${omrResult.detected_vote}`;

  if (io) io.emit('scan:recorded', {
    serial_number: serialNumber,
    candidate_id: omrResult.detected_vote,
    station: source,
    pass_id: pass.id,
    count: parseInt(count),
    confidence: omrResult.confidence,
  });

  log(`DONE [${race.name} R${roundRow.round_number}] SN=${serialNumber} → ${candidateName} total=${Date.now() - t0}ms`, 'success');
  return {
    success: true,
    serial_number: serialNumber,
    candidate: candidateName,
    confidence: omrResult.confidence,
    pass_number: pass.pass_number,
    count: parseInt(count),
    race_name: race.name,
    round_number: roundRow.round_number,
    message: `[${race.name} R${roundRow.round_number}] Ballot ${serialNumber} → ${candidateName} (${(omrResult.confidence * 100).toFixed(1)}%)`,
  };
}

/**
 * Classify a processBallot() result into a short outcome string for scan_uploads.
 * Every agent upload gets exactly one row in scan_uploads regardless of outcome.
 */
function deriveOutcome(result) {
  if (!result) return 'error';
  if (result.type === 'wrong_station') return 'wrong_station';
  if (result.flag_reason === 'round_not_open') return 'round_not_open';
  if (result.flagged) return result.flag_reason || 'flagged';
  if (!result.success) return 'error';
  return 'counted';
}

/**
 * Record one row per agent upload. Called by station upload route and scanWatcher
 * after processBallot returns. Looks up the active/most-recent pass for the round
 * so uploads are bucketed per pass for reporting.
 */
async function recordScanUpload({ stationId, roundId, result, io }) {
  try {
    const outcome = deriveOutcome(result);
    const serialNumber = result?.serial_number || null;

    // Resolve round_id from the serial if the caller didn't supply one
    // (watcher path doesn't know the round upfront).
    let resolvedRoundId = roundId || null;
    if (!resolvedRoundId && serialNumber) {
      const { rows: [bs] } = await db.query(
        'SELECT round_id FROM ballot_serials WHERE serial_number = $1 LIMIT 1',
        [serialNumber]
      );
      if (bs) resolvedRoundId = bs.round_id;
    }

    let passId = null;
    if (resolvedRoundId) {
      const { rows: [p] } = await db.query(
        `SELECT id FROM passes
         WHERE round_id = $1 AND status != 'deleted'
         ORDER BY (status = 'active') DESC, pass_number DESC
         LIMIT 1`,
        [resolvedRoundId]
      );
      if (p) passId = p.id;
    }
    await db.query(
      `INSERT INTO scan_uploads (station_id, round_id, pass_id, serial_number, outcome)
       VALUES ($1, $2, $3, $4, $5)`,
      [stationId || 'unknown', resolvedRoundId, passId, serialNumber, outcome]
    );

    // Single event the Scanner page can listen on — fires for every upload regardless
    // of whether it was counted, flagged, duplicate, etc. This is the live-update trigger
    // for the Total/Local pills.
    if (io) {
      io.emit('scan:upload', {
        round_id: resolvedRoundId,
        pass_id: passId,
        station_id: stationId || 'unknown',
        outcome,
        serial_number: serialNumber,
      });
    }
  } catch (err) {
    console.error('[Scan] Failed to record upload:', err.message);
  }
}

module.exports = {
  processBallot,
  getOrCreateActivePass,
  recordScanUpload,
  RoundNotScannableError,
  SCANNABLE_ROUND_STATUSES,
};
