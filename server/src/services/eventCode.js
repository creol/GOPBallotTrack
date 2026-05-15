// eventCode.js — short, URL-safe code for an election ("event").
//
// The event_code is the path segment in the voter URL:
//   https://vote.<domain>/<event_code>/?t=<token>
// It is public and low-stakes (the token is the real secret), but a short
// random code is friendlier and less enumerable than a sequential id.

const crypto = require('crypto');
const db = require('../db');

// 31-character alphabet — no 0/O/1/I/L or other easily-confused glyphs.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

/**
 * Generate a random CODE_LENGTH-char code from ALPHABET using a uniform,
 * rejection-sampled draw over crypto.randomBytes (no modulo bias).
 */
function randomCode() {
  let out = '';
  while (out.length < CODE_LENGTH) {
    const byte = crypto.randomBytes(1)[0];
    // Reject bytes in the biased tail so every letter is equally likely.
    if (byte >= 256 - (256 % ALPHABET.length)) continue;
    out += ALPHABET[byte % ALPHABET.length];
  }
  return out;
}

/**
 * Generate an event_code that is not already used by another election.
 * @returns {Promise<string>}
 */
async function generateUniqueEventCode() {
  for (let attempt = 0; attempt < 50; attempt++) {
    const code = randomCode();
    const { rows } = await db.query(
      'SELECT 1 FROM elections WHERE event_code = $1', [code]
    );
    if (rows.length === 0) return code;
  }
  throw new Error('Could not generate a unique event_code after 50 attempts');
}

module.exports = { generateUniqueEventCode, randomCode, ALPHABET };
