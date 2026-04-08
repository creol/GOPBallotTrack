const db = require('../db');

/**
 * Write a log entry to the scan_logs table.
 *
 * @param {Object} entry
 * @param {number}  [entry.electionId]
 * @param {string}  entry.source       - 'agent:station-1', 'server:scan', 'server:general'
 * @param {string}  entry.level        - 'debug' | 'info' | 'success' | 'warn' | 'error'
 * @param {string}  entry.message
 * @param {string}  [entry.serialNumber]
 * @param {number}  [entry.roundId]
 * @param {string}  [entry.stationId]
 * @param {Object}  [entry.metadata]
 */
async function writeLog(entry) {
  try {
    await db.query(
      `INSERT INTO scan_logs (election_id, source, level, message, serial_number, round_id, station_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entry.electionId || null,
        entry.source,
        entry.level || 'info',
        entry.message,
        entry.serialNumber || null,
        entry.roundId || null,
        entry.stationId || null,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
      ]
    );
  } catch (err) {
    // Don't let logging failures break the app
    console.error('[ScanLog] Failed to write log:', err.message);
  }
}

/**
 * Write a batch of log entries (used by agent log upload).
 */
async function writeBatch(entries) {
  if (!entries || entries.length === 0) return;

  const values = [];
  const params = [];
  let idx = 1;

  for (const e of entries) {
    values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`);
    params.push(
      e.electionId || null,
      e.source,
      e.level || 'info',
      e.message,
      e.serialNumber || null,
      e.roundId || null,
      e.stationId || null,
      e.metadata ? JSON.stringify(e.metadata) : null,
      e.timestamp ? new Date(e.timestamp) : new Date(),
    );
  }

  try {
    await db.query(
      `INSERT INTO scan_logs (election_id, source, level, message, serial_number, round_id, station_id, metadata, created_at)
       VALUES ${values.join(', ')}`,
      params
    );
  } catch (err) {
    console.error('[ScanLog] Batch write failed:', err.message);
  }
}

module.exports = { writeLog, writeBatch };
