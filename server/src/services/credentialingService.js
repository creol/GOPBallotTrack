// credentialingService.js — shared helpers for voter credentialing
// (Prompt H, stage H3).

const db = require('../db');

/**
 * Is an electronic vote currently open for this event?
 *
 * Credentialing and an open electronic vote are mutually exclusive. "Open"
 * means a round of an electronic-mode race in this election is in
 * 'voting_open' status. Paper races are unaffected — their voting_open state
 * is the paper-scanning workflow and does not gate credentialing.
 *
 * @param {number} electionId
 * @returns {Promise<boolean>}
 */
async function isVoteOpenForEvent(electionId) {
  const { rows } = await db.query(
    `SELECT 1
       FROM rounds r
       JOIN races ra ON ra.id = r.race_id
      WHERE ra.election_id = $1
        AND ra.voting_mode = 'electronic'
        AND r.status = 'voting_open'
      LIMIT 1`,
    [electionId]
  );
  return rows.length > 0;
}

/**
 * Token tallies for an event's credentialing status view.
 * @returns {Promise<{total,activated_in_person,activated_remote,revoked,available}>}
 */
async function getCredentialingStatus(electionId) {
  const { rows: [c] } = await db.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status = 'activated' AND voter_type = 'in_person')::int AS activated_in_person,
       COUNT(*) FILTER (WHERE status = 'activated' AND voter_type = 'remote')::int    AS activated_remote,
       COUNT(*) FILTER (WHERE status = 'revoked')::int                                AS revoked,
       COUNT(*) FILTER (WHERE status = 'unactivated')::int                            AS available
     FROM voter_tokens
     WHERE event_id = $1`,
    [electionId]
  );
  return c;
}

/** Recent activations for the status view — token shown only as its last 2 chars. */
async function getRecentActivations(electionId, limit = 50) {
  const { rows } = await db.query(
    `SELECT token_last2, activated_at, voter_type, activated_by
       FROM voter_tokens
      WHERE event_id = $1 AND status = 'activated'
      ORDER BY activated_at DESC NULLS LAST
      LIMIT $2`,
    [electionId, limit]
  );
  return rows;
}

/**
 * Normalize raw credentialer input into a bare token.
 * Accepts a typed token, or a full voter URL — a handheld 2D scanner reads the
 * sticker QR as the whole `…/<event_code>/?t=<token>` URL, not just the token.
 *
 * @param {string} input
 * @returns {string|null} uppercased alphanumeric token, or null if empty
 */
function extractToken(input) {
  if (!input) return null;
  let s = String(input).trim();
  const m = s.match(/[?&]t=([^&\s]+)/i); // pull ?t= / &t= out of a scanned URL
  if (m) s = m[1];
  s = s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length ? s : null;
}

module.exports = { isVoteOpenForEvent, getCredentialingStatus, getRecentActivations, extractToken };
