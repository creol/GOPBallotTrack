const crypto = require('crypto');
const db = require('../db');

// Uppercase alphanumeric, no ambiguous chars (0/O, 1/I/L)
const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const SN_LENGTH = 8;

function generateSN() {
  const bytes = crypto.randomBytes(SN_LENGTH);
  let sn = '';
  for (let i = 0; i < SN_LENGTH; i++) {
    sn += CHARSET[bytes[i] % CHARSET.length];
  }
  return sn;
}

/**
 * Generate `quantity` unique serial numbers for a round and store them.
 * Returns the array of created ballot_serial rows.
 */
async function generateSerials(roundId, quantity) {
  const serials = [];
  const generated = new Set();

  // Fetch existing SNs to avoid collisions
  const { rows: existing } = await db.query(
    'SELECT serial_number FROM ballot_serials WHERE round_id = $1',
    [roundId]
  );
  for (const row of existing) generated.add(row.serial_number);

  while (serials.length < quantity) {
    const sn = generateSN();
    if (generated.has(sn)) continue;
    generated.add(sn);
    serials.push(sn);
  }

  // Bulk insert
  const values = serials.map((sn, i) => `($1, $${i + 2})`).join(', ');
  const params = [roundId, ...serials];
  const { rows } = await db.query(
    `INSERT INTO ballot_serials (round_id, serial_number)
     VALUES ${values}
     RETURNING *`,
    params
  );

  return rows;
}

module.exports = { generateSerials, generateSN };
