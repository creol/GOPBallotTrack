const fs = require('fs');
const path = require('path');
const db = require('../db');
const { findQRInImage, processScannedBallot } = require('./omrService');

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

/**
 * Get or create an active pass for a round.
 */
async function getOrCreateActivePass(roundId) {
  const { rows: [existing] } = await db.query(
    "SELECT * FROM passes WHERE round_id = $1 AND status = 'active' ORDER BY pass_number DESC LIMIT 1",
    [roundId]
  );
  if (existing) return existing;

  const { rows: [{ max }] } = await db.query(
    "SELECT COALESCE(MAX(pass_number), 0) as max FROM passes WHERE round_id = $1 AND status != 'deleted'",
    [roundId]
  );

  await db.query(
    "UPDATE rounds SET status = 'tallying' WHERE id = $1 AND status IN ('pending_needs_action', 'ready')",
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
  const log = (msg) => console.log(`[Scan:${source}] ${msg} (+${Date.now() - t0}ms)`);

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
          `INSERT INTO reviewed_ballots (round_id, pass_id, scanner_id, flag_reason, image_path, notes)
           VALUES ($1, $2, $3, 'qr_not_found', $4, $5)`,
          [assignedRoundId, pass.id, scannerId || null, savedPath,
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
  if (!serialNumber || serialNumber.length < 8) {
    const savedPath = saveImageForReview(buffer, 'invalidqr', filePath);
    if (assignedRoundId) {
      try {
        const pass = await getOrCreateActivePass(assignedRoundId);
        await db.query(
          `INSERT INTO reviewed_ballots (round_id, pass_id, scanner_id, flag_reason, image_path, notes)
           VALUES ($1, $2, $3, 'invalid_qr', $4, $5)`,
          [assignedRoundId, pass.id, scannerId || null, savedPath,
           `Invalid QR data: ${qrResult.qrData}. Source: ${source}`]
        );
      } catch (dbErr) { console.error('[Scan] Failed to create review record:', dbErr.message); }
    }
    if (io) io.emit('scan:error', { reason: 'invalid_qr', station: source });
    return { success: true, flagged: true, flag_reason: 'invalid_qr', error: `Invalid QR data: ${qrResult.qrData}` };
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
            `INSERT INTO reviewed_ballots (round_id, pass_id, original_serial_id, scanner_id, flag_reason, image_path, notes)
             VALUES ($1, $2, $3, $4, 'wrong_station', $5, $6)`,
            [assignedRoundId, pass.id, wrong.id, scannerId || null, savedPath,
             `Belongs to ${wrong.race_name} Round ${wrong.round_number}. Source: ${source}`]
          );
        } catch (dbErr) { console.error('[Scan] Failed to create review record:', dbErr.message); }
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
          message: `This ballot belongs to ${wrong.race_name} Round ${wrong.round_number}. Please scan it at that race's station.`,
          targetRace: wrong.race_name,
          targetRound: wrong.round_number,
        };
      }

      // Not found in any tallying round — add to review queue
      const { rows: [anyBallot] } = await db.query(
        'SELECT id FROM ballot_serials WHERE serial_number = $1', [serialNumber]
      );
      if (anyBallot) {
        // Exists but wrong round — flag it and save image
        const savedPath = saveImageForReview(buffer, `wronground-${serialNumber}`, filePath);
        const pass = await getOrCreateActivePass(assignedRoundId);
        await db.query(
          `INSERT INTO reviewed_ballots (round_id, pass_id, original_serial_id, scanner_id, flag_reason, image_path, notes)
           VALUES ($1, $2, $3, $4, 'wrong_round', $5, 'Serial not found in assigned round')`,
          [assignedRoundId, pass.id, anyBallot.id, scannerId || null, savedPath]
        );
        if (io) io.emit('scan:review_needed', { serial_number: serialNumber, reason: 'wrong_round', station: source });
        return { success: true, flagged: true, flag_reason: 'wrong_round', error: 'Serial number not found in assigned round' };
      }

      // Completely unknown serial — still save the image
      const savedPath = saveImageForReview(buffer, `unknown-${serialNumber}`, filePath);
      try {
        const pass = await getOrCreateActivePass(assignedRoundId);
        await db.query(
          `INSERT INTO reviewed_ballots (round_id, pass_id, scanner_id, flag_reason, image_path, notes)
           VALUES ($1, $2, $3, 'unknown_sn', $4, $5)`,
          [assignedRoundId, pass.id, scannerId || null, savedPath,
           `Unrecognized serial number: ${serialNumber}. Source: ${source}`]
        );
      } catch (dbErr) { console.error('[Scan] Failed to create review record:', dbErr.message); }
      if (io) io.emit('scan:error', { reason: 'unknown_sn', serial_number: serialNumber, station: source });
      return { success: true, flagged: true, flag_reason: 'unknown_sn', error: 'Unrecognized serial number' };
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
    return { success: true, flagged: true, flag_reason: 'invalid_sn', error: `Serial number ${serialNumber} not found`, image_path: savedPath };
  }

  // Don't reject based on serial status — ballots are scanned multiple times across passes
  // The per-pass duplicate check below handles actual duplicates within a single pass
  if (ballotInfo.status === 'spoiled' || ballotInfo.status === 'damaged') {
    const savedPath = saveImageForReview(buffer, `${ballotInfo.status}-${serialNumber}`, filePath);
    if (io) io.emit('scan:duplicate', { serial_number: serialNumber, station: source });
    return { success: true, flagged: true, flag_reason: ballotInfo.status, error: `Ballot ${serialNumber} is ${ballotInfo.status}`, image_path: savedPath };
  }

  const roundId = ballotInfo.round_id;
  const raceId = ballotInfo.race_id;
  const electionId = ballotInfo.election_id;

  // Get or create active pass
  const pass = await getOrCreateActivePass(roundId);

  // Check for duplicate in this pass
  const { rows: [existingScan] } = await db.query(
    'SELECT id FROM scans WHERE pass_id = $1 AND ballot_serial_id = $2',
    [pass.id, ballotInfo.id]
  );
  if (existingScan) {
    const savedPath = saveImageForReview(buffer, `duplicate-${serialNumber}`, filePath);
    if (io) io.emit('scan:duplicate', { serial_number: serialNumber, station: source });
    return { success: true, flagged: true, flag_reason: 'duplicate', error: `Duplicate in pass ${pass.pass_number}`, image_path: savedPath };
  }

  // Load ballot spec for OMR
  const ballotSpec = loadBallotSpec(electionId, roundId);

  if (!ballotSpec) {
    const savedPath = saveImageForReview(buffer, `nospec-${serialNumber}`, filePath);
    await db.query(
      `INSERT INTO reviewed_ballots (round_id, pass_id, original_serial_id, scanner_id, flag_reason, image_path)
       VALUES ($1, $2, $3, $4, 'no_spec', $5)`,
      [roundId, pass.id, ballotInfo.id, scannerId || null, savedPath]
    );
    if (io) io.emit('scan:review_needed', { serial_number: serialNumber, reason: 'no_spec', station: source });
    return { success: true, flagged: true, flag_reason: 'no_spec', error: 'No ballot spec — cannot run OMR' };
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
      `INSERT INTO reviewed_ballots (round_id, pass_id, original_serial_id, scanner_id, flag_reason, image_path, omr_scores)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [roundId, pass.id, ballotInfo.id, scannerId || null, omrResult.flag_reason, flaggedPath,
       JSON.stringify(omrResult.candidates)]
    );

    if (io) io.emit('scan:review_needed', {
      serial_number: serialNumber,
      reason: omrResult.flag_reason,
      station: source,
      candidates: omrResult.candidates,
    });

    return {
      success: true,
      flagged: true,
      serial_number: serialNumber,
      flag_reason: omrResult.flag_reason,
      message: `Ballot ${serialNumber} flagged: ${omrResult.flag_reason}`,
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

  log(`DONE SN=${serialNumber} → ${candidateName} total=${Date.now() - t0}ms`);
  return {
    success: true,
    serial_number: serialNumber,
    candidate: candidateName,
    confidence: omrResult.confidence,
    pass_number: pass.pass_number,
    count: parseInt(count),
    message: `Ballot ${serialNumber} → ${candidateName} (${(omrResult.confidence * 100).toFixed(1)}%)`,
  };
}

module.exports = { processBallot, getOrCreateActivePass };
