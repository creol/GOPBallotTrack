// voterTokenService.js — voter QR-sticker token generation and hashing
// (Prompt H, stage H2).
//
// A token is the credential printed on a QR sticker. It is 6 characters from a
// 31-char ambiguity-free alphabet (~29.7 bits of entropy).
//
// HASHING — token_hash is an HMAC-SHA256 of the token, keyed by a server-side
// secret (EV_TOKEN_SECRET). This was a deliberate choice over argon2/bcrypt:
//   * It is fast — a 5,000-token batch hashes in milliseconds, where a slow
//     KDF would take minutes.
//   * It is deterministic — the same token always hashes the same way, so
//     duplicate-token detection works with a plain DB unique index. A salted
//     KDF cannot do this without storing plaintext.
//   * A database leak alone is useless: without EV_TOKEN_SECRET the ~30-bit
//     token space cannot be brute-forced from the hashes.
//
// ANONYMITY NOTE: this service writes voter_tokens only. The vote-recording
// path (H4) must never join voter_tokens to votes — see migration 037.

const crypto = require('crypto');
const db = require('../db');

// 31-character alphabet — no 0/O/1/I/L (matches the H2 spec).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TOKEN_LENGTH = 6;

// HMAC key. Must be stable across restarts or existing hashes become
// unverifiable, so the dev fallback is a FIXED string (not random).
const TOKEN_SECRET = process.env.EV_TOKEN_SECRET || 'dev-insecure-ev-token-secret-change-me';
if (!process.env.EV_TOKEN_SECRET) {
  const msg = '[voterTokenService] EV_TOKEN_SECRET is not set — using an insecure dev default.';
  if (process.env.NODE_ENV === 'production') {
    console.error(`\x1b[31m${msg} SET EV_TOKEN_SECRET BEFORE GENERATING REAL STICKERS.\x1b[0m`);
  } else {
    console.warn(`\x1b[33m${msg}\x1b[0m`);
  }
}

/**
 * Generate one random TOKEN_LENGTH-char token. Uses rejection sampling over
 * crypto.randomBytes so every character is uniformly likely (no modulo bias).
 */
function generateToken() {
  const cutoff = 256 - (256 % ALPHABET.length);
  let out = '';
  while (out.length < TOKEN_LENGTH) {
    const byte = crypto.randomBytes(1)[0];
    if (byte >= cutoff) continue;
    out += ALPHABET[byte % ALPHABET.length];
  }
  return out;
}

/** HMAC-SHA256 hash of a token (hex). Deterministic for a given secret. */
function hashToken(token) {
  return crypto.createHmac('sha256', TOKEN_SECRET)
    .update(String(token).toUpperCase())
    .digest('hex');
}

/**
 * Constant-time check that a plaintext token matches a stored hash.
 * (Used by H3/H4; included here so all token crypto lives in one place.)
 */
function verifyToken(token, storedHash) {
  const computed = Buffer.from(hashToken(token));
  const stored = Buffer.from(String(storedHash || ''));
  return computed.length === stored.length && crypto.timingSafeEqual(computed, stored);
}

/**
 * Generate a batch of unique voter tokens for an event and persist them.
 *
 * Tokens are returned in PLAINTEXT (the caller needs them to render QR codes);
 * only their HMAC hashes are stored. Plaintext exists only for the lifetime of
 * the request and is never written to the database.
 *
 * Collision-safe: candidate hashes are checked against existing tokens for the
 * event and against each other; any collision is regenerated. The
 * (event_id, token_hash) unique index (migration 040) is the final backstop.
 *
 * @param {object} opts
 * @param {number} opts.eventId
 * @param {number} opts.count
 * @param {object} opts.batch        - { batchName, sizePreset, generatedBy, notes }
 * @returns {Promise<{ batchId:number, tokens:string[] }>}
 */
async function generateTokenBatch({ eventId, count, batch }) {
  if (!Number.isInteger(count) || count < 1 || count > 50000) {
    throw new Error('count must be an integer between 1 and 50000');
  }

  // Build `count` unique tokens. Map keyed by hash → plaintext.
  const byHash = new Map();
  let guard = 0;
  while (byHash.size < count) {
    if (guard++ > count * 100) throw new Error('Token generation failed to converge');
    const need = count - byHash.size;
    const candidates = [];
    for (let i = 0; i < need; i++) {
      const tok = generateToken();
      candidates.push({ tok, hash: hashToken(tok) });
    }
    // Drop within-batch duplicates.
    const freshHashes = [];
    for (const c of candidates) {
      if (!byHash.has(c.hash)) { byHash.set(c.hash, c.tok); freshHashes.push(c.hash); }
    }
    // Drop any that already exist for this event.
    if (freshHashes.length) {
      const { rows } = await db.query(
        'SELECT token_hash FROM voter_tokens WHERE event_id = $1 AND token_hash = ANY($2)',
        [eventId, freshHashes]
      );
      for (const r of rows) byHash.delete(r.token_hash);
    }
  }

  const entries = [...byHash.entries()]; // [ [hash, token], ... ]

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [batchRow] } = await client.query(
      `INSERT INTO sticker_batches (event_id, batch_name, count, size_preset, generated_by, notes)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [eventId, batch.batchName || null, count, batch.sizePreset || null,
       batch.generatedBy || null, batch.notes || null]
    );
    const batchId = batchRow.id;

    // Bulk-insert voter_tokens in chunks to keep parameter counts sane.
    const CHUNK = 1000;
    for (let i = 0; i < entries.length; i += CHUNK) {
      const slice = entries.slice(i, i + CHUNK);
      const values = [];
      const params = [];
      slice.forEach(([hash], idx) => {
        params.push(`($${idx * 2 + 1}, $${idx * 2 + 2})`);
        values.push(eventId, hash);
      });
      await client.query(
        `INSERT INTO voter_tokens (event_id, token_hash) VALUES ${params.join(', ')}`,
        values
      );
    }

    await client.query('COMMIT');
    return { batchId, tokens: entries.map(([, tok]) => tok) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { generateToken, hashToken, verifyToken, generateTokenBatch, ALPHABET, TOKEN_LENGTH };
