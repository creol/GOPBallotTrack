// voterEligibility.js — per-race voter eligibility check (Prompt H, stage H1).
//
// Forward-compatibility hook. The voter_race_eligibility table (migration 039)
// is schema-only through H1-H6: nothing populates it yet. This function is
// wired in from day one — H4's vote-submission path calls it — so the future
// per-race eligibility feature is a pure data-and-UI drop-in with no refactor
// of callers.
//
// ANONYMITY NOTE: voter_race_eligibility links token_id <-> race_id only. It
// must NEVER be joined to the `votes` table. This function reads eligibility
// rows in isolation.

const db = require('../db');

/**
 * Determine whether a voter token may vote in a given race.
 *
 * Rule (per the H1 spec):
 *   - If voter_race_eligibility has a row for this (token, race), the result
 *     is that row's `eligible` value.
 *   - Otherwise the default is permissive: return true.
 *
 * @param {number} tokenId - voter_tokens.id
 * @param {number} raceId  - races.id
 * @returns {Promise<boolean>} true if the voter is eligible for the race
 */
async function isVoterEligibleForRace(tokenId, raceId) {
  const { rows } = await db.query(
    'SELECT eligible FROM voter_race_eligibility WHERE token_id = $1 AND race_id = $2',
    [tokenId, raceId]
  );

  if (rows.length === 0) {
    return true; // no eligibility row — default permissive
  }

  return rows[0].eligible === true;
}

module.exports = { isVoterEligibleForRace };
