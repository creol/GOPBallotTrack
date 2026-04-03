const db = require('../db');

/**
 * Validate a serial number for scanning within a pass.
 * Returns { valid, error?, ballotSerial? }
 */
async function validateScan(passId, serialNumber) {
  // Get pass and round info
  const { rows: [pass] } = await db.query('SELECT * FROM passes WHERE id = $1', [passId]);
  if (!pass) return { valid: false, error: 'Pass not found' };
  if (pass.status !== 'active') return { valid: false, error: 'Pass is not active' };

  // Check SN exists for this round
  const { rows: [ballotSerial] } = await db.query(
    'SELECT * FROM ballot_serials WHERE serial_number = $1 AND round_id = $2',
    [serialNumber, pass.round_id]
  );
  if (!ballotSerial) return { valid: false, error: 'Serial number not found for this round' };

  // Check SN is not spoiled
  if (ballotSerial.status === 'spoiled') {
    return { valid: false, error: 'This ballot has been marked as spoiled' };
  }

  // Check SN not already scanned in this pass
  const { rows: [existing] } = await db.query(
    'SELECT id FROM scans WHERE pass_id = $1 AND ballot_serial_id = $2',
    [passId, ballotSerial.id]
  );
  if (existing) return { valid: false, error: 'This ballot has already been scanned in this pass' };

  return { valid: true, ballotSerial };
}

/**
 * Record a scan. Returns the created scan row and updated count.
 */
async function recordScan({ passId, serialNumber, candidateId, ballotBoxId, scannedBy, frontImagePath, backImagePath }) {
  const validation = await validateScan(passId, serialNumber);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const { ballotSerial } = validation;

  // Record the scan
  const { rows: [scan] } = await db.query(
    `INSERT INTO scans (pass_id, ballot_serial_id, candidate_id, ballot_box_id, scanned_by, front_image_path, back_image_path)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [passId, ballotSerial.id, candidateId, ballotBoxId || null, scannedBy || null, frontImagePath || null, backImagePath || null]
  );

  // Mark serial as counted
  await db.query(
    "UPDATE ballot_serials SET status = 'counted' WHERE id = $1",
    [ballotSerial.id]
  );

  // Get scan count for this pass
  const { rows: [{ count }] } = await db.query(
    'SELECT COUNT(*) as count FROM scans WHERE pass_id = $1',
    [passId]
  );

  return { scan, count: parseInt(count) };
}

/**
 * Log a spoiled ballot.
 */
async function logSpoiledBallot({ roundId, serialNumber, spoilType, notes, imagePath, reportedBy }) {
  // Validate SN exists for this round
  const { rows: [ballotSerial] } = await db.query(
    'SELECT * FROM ballot_serials WHERE serial_number = $1 AND round_id = $2',
    [serialNumber, roundId]
  );
  if (!ballotSerial) throw new Error('Serial number not found for this round');

  if (ballotSerial.status === 'spoiled') {
    throw new Error('This ballot is already marked as spoiled');
  }

  // Mark as spoiled
  await db.query(
    "UPDATE ballot_serials SET status = 'spoiled' WHERE id = $1",
    [ballotSerial.id]
  );

  // Create spoiled ballot record
  const { rows: [spoiled] } = await db.query(
    `INSERT INTO spoiled_ballots (round_id, ballot_serial_id, spoil_type, notes, image_path, reported_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [roundId, ballotSerial.id, spoilType, notes || null, imagePath || null, reportedBy || null]
  );

  return spoiled;
}

module.exports = { validateScan, recordScan, logSpoiledBallot };
