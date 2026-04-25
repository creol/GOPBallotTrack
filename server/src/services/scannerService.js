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

  // Reject if the round itself is no longer in a scannable state.
  const { rows: [round] } = await db.query('SELECT status FROM rounds WHERE id = $1', [pass.round_id]);
  if (!round) return { valid: false, error: 'Round not found' };
  if (!['voting_open', 'voting_closed', 'tallying'].includes(round.status)) {
    return { valid: false, error: `Round is not open for scanning (status=${round.status})` };
  }

  // Check SN exists for this round
  const { rows: [ballotSerial] } = await db.query(
    'SELECT * FROM ballot_serials WHERE serial_number = $1 AND round_id = $2',
    [serialNumber, pass.round_id]
  );
  if (!ballotSerial) return { valid: false, error: 'Serial number not found for this round' };

  // Check SN is not spoiled/damaged
  if (['spoiled', 'damaged'].includes(ballotSerial.status)) {
    return { valid: false, error: `This ballot has been marked as ${ballotSerial.status}` };
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

module.exports = { validateScan, recordScan };
