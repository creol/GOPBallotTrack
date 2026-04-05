const db = require('../db');

/**
 * Build a side-by-side comparison of all passes for a round.
 * Returns { candidates, passes, comparison, hasMismatch }
 */
async function getComparison(roundId) {
  // Get all non-deleted, complete passes
  const { rows: passes } = await db.query(
    "SELECT * FROM passes WHERE round_id = $1 AND status = 'complete' ORDER BY pass_number",
    [roundId]
  );

  // Get round and race info
  const { rows: [round] } = await db.query('SELECT * FROM rounds WHERE id = $1', [roundId]);
  const { rows: [race] } = await db.query('SELECT * FROM races WHERE id = $1', [round.race_id]);

  // Get active candidates
  const { rows: candidates } = await db.query(
    "SELECT * FROM candidates WHERE race_id = $1 AND status = 'active' ORDER BY display_order",
    [race.id]
  );

  // For each pass, count votes per candidate
  const comparison = [];
  for (const candidate of candidates) {
    const row = { candidate_id: candidate.id, candidate_name: candidate.name, counts: {} };
    for (const pass of passes) {
      const { rows: [{ count }] } = await db.query(
        'SELECT COUNT(*) as count FROM scans WHERE pass_id = $1 AND candidate_id = $2',
        [pass.id, candidate.id]
      );
      row.counts[pass.pass_number] = parseInt(count);
    }
    comparison.push(row);
  }

  // Detect mismatches — compare pass 1 vs pass 2 (and any others)
  let hasMismatch = false;
  if (passes.length >= 2) {
    for (const row of comparison) {
      const values = Object.values(row.counts);
      if (new Set(values).size > 1) {
        hasMismatch = true;
        break;
      }
    }
  }

  return { candidates, passes, comparison, hasMismatch, round, race };
}

/**
 * Compute and store final results for a round.
 * Uses the last completed pass for vote counts.
 */
async function computeResults(roundId) {
  const { rows: passes } = await db.query(
    "SELECT * FROM passes WHERE round_id = $1 AND status = 'complete' ORDER BY pass_number DESC LIMIT 1",
    [roundId]
  );
  if (passes.length === 0) throw new Error('No completed passes');

  const lastPass = passes[0];

  const { rows: [round] } = await db.query('SELECT * FROM rounds WHERE id = $1', [roundId]);
  const { rows: candidates } = await db.query(
    "SELECT * FROM candidates WHERE race_id = $1 AND status = 'active' ORDER BY display_order",
    [round.race_id]
  );

  // Count total votes from last pass
  const { rows: [{ count: totalStr }] } = await db.query(
    'SELECT COUNT(*) as count FROM scans WHERE pass_id = $1',
    [lastPass.id]
  );
  const total = parseInt(totalStr);

  // Clear any existing results for this round
  await db.query('DELETE FROM round_results WHERE round_id = $1', [roundId]);

  // Compute per-candidate results
  const results = [];
  for (const candidate of candidates) {
    const { rows: [{ count: voteStr }] } = await db.query(
      'SELECT COUNT(*) as count FROM scans WHERE pass_id = $1 AND candidate_id = $2',
      [lastPass.id, candidate.id]
    );
    const voteCount = parseInt(voteStr);
    const percentage = total > 0 ? (voteCount / total) * 100 : 0;

    const { rows: [result] } = await db.query(
      `INSERT INTO round_results (round_id, candidate_id, vote_count, percentage)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [roundId, candidate.id, voteCount, percentage.toFixed(5)]
    );
    results.push({ ...result, candidate_name: candidate.name });
  }

  return results;
}

/**
 * Confirm a round (judge action).
 */
async function confirmRound({ roundId, confirmedByName, isOverride, overrideNotes }) {
  // Verify at least 2 complete passes
  const { rows: passes } = await db.query(
    "SELECT * FROM passes WHERE round_id = $1 AND status = 'complete'",
    [roundId]
  );
  if (passes.length < 2) {
    throw new Error('At least 2 completed passes are required before confirmation');
  }

  // Compute results
  const results = await computeResults(roundId);

  // Record confirmation
  await db.query(
    `INSERT INTO round_confirmations (round_id, confirmed_by_role, confirmed_by_name, is_override, override_notes)
     VALUES ($1, $2, $3, $4, $5)`,
    [roundId, 'judge', confirmedByName, isOverride, overrideNotes || null]
  );

  // Update round status to round_finalized
  await db.query(
    `UPDATE rounds SET status = 'round_finalized', confirmed_by = $1, confirmed_at = NOW()
     WHERE id = $2`,
    [confirmedByName, roundId]
  );

  return results;
}

/**
 * Release a round (chair action).
 */
async function releaseRound({ roundId, releasedByName }) {
  const { rows: [round] } = await db.query('SELECT * FROM rounds WHERE id = $1', [roundId]);
  if (!round) throw new Error('Round not found');
  if (round.status !== 'round_finalized') {
    throw new Error('Round must be finalized before release');
  }

  await db.query(
    `UPDATE rounds SET published_at = NOW(), released_by = $1, released_at = NOW()
     WHERE id = $2`,
    [releasedByName, roundId]
  );

  return { roundId, releasedByName };
}

/**
 * Get chair preview data — exactly what the public will see.
 */
async function getChairPreview(roundId) {
  const { rows: [round] } = await db.query('SELECT * FROM rounds WHERE id = $1', [roundId]);
  if (!round) throw new Error('Round not found');

  const { rows: [race] } = await db.query('SELECT * FROM races WHERE id = $1', [round.race_id]);
  const { rows: [election] } = await db.query('SELECT * FROM elections WHERE id = $1', [race.election_id]);

  const { rows: results } = await db.query(
    `SELECT rr.*, c.name as candidate_name
     FROM round_results rr
     JOIN candidates c ON c.id = rr.candidate_id
     WHERE rr.round_id = $1
     ORDER BY rr.vote_count DESC`,
    [roundId]
  );

  const { rows: serials } = await db.query(
    "SELECT serial_number, status FROM ballot_serials WHERE round_id = $1 AND status = 'counted' ORDER BY serial_number",
    [roundId]
  );

  return { round, race, election, results, serials };
}

/**
 * Get chair decision data — results + threshold info.
 */
async function getChairDecision(roundId) {
  const preview = await getChairPreview(roundId);
  const { race } = preview;

  let thresholdValue;
  if (race.threshold_type === 'majority') thresholdValue = 50;
  else if (race.threshold_type === 'two_thirds') thresholdValue = 66.66667;
  else thresholdValue = parseFloat(race.threshold_value) || 50;

  const totalVotes = preview.results.reduce((sum, r) => sum + r.vote_count, 0);
  const winner = preview.results.find(r => {
    const pct = totalVotes > 0 ? (r.vote_count / totalVotes) * 100 : 0;
    return pct > thresholdValue;
  });

  return {
    ...preview,
    threshold_type: race.threshold_type,
    threshold_value: thresholdValue,
    total_votes: totalVotes,
    has_winner: !!winner,
    winner: winner || null,
  };
}

module.exports = { getComparison, computeResults, confirmRound, releaseRound, getChairPreview, getChairDecision };
