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

  // Get ALL candidates (including withdrawn — they still appear in results)
  const { rows: candidates } = await db.query(
    "SELECT * FROM candidates WHERE race_id = $1 ORDER BY display_order",
    [race.id]
  );

  // For each pass, count votes per candidate
  const comparison = [];
  for (const candidate of candidates) {
    const row = { candidate_id: candidate.id, candidate_name: candidate.name, counts: {} };
    for (const pass of passes) {
      const { rows: [{ count }] } = await db.query(
        `SELECT COUNT(*) as count FROM scans s
         JOIN ballot_serials bs ON bs.id = s.ballot_serial_id
         WHERE s.pass_id = $1 AND s.candidate_id = $2 AND bs.status != 'spoiled'`,
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
  // Include ALL candidates (even withdrawn) so they appear in results
  const { rows: candidates } = await db.query(
    "SELECT * FROM candidates WHERE race_id = $1 ORDER BY display_order",
    [round.race_id]
  );

  // Count total votes from last pass (exclude spoiled ballots)
  const { rows: [{ count: totalStr }] } = await db.query(
    `SELECT COUNT(*) as count FROM scans s
     JOIN ballot_serials bs ON bs.id = s.ballot_serial_id
     WHERE s.pass_id = $1 AND bs.status != 'spoiled'`,
    [lastPass.id]
  );
  const total = parseInt(totalStr);

  // Preserve existing outcomes before recomputing
  const { rows: existingResults } = await db.query(
    'SELECT candidate_id, outcome FROM round_results WHERE round_id = $1',
    [roundId]
  );
  const savedOutcomes = {};
  for (const er of existingResults) {
    if (er.outcome) savedOutcomes[er.candidate_id] = er.outcome;
  }

  // Clear existing results for this round
  await db.query('DELETE FROM round_results WHERE round_id = $1', [roundId]);

  // Compute per-candidate results
  const results = [];
  for (const candidate of candidates) {
    const { rows: [{ count: voteStr }] } = await db.query(
      `SELECT COUNT(*) as count FROM scans s
       JOIN ballot_serials bs ON bs.id = s.ballot_serial_id
       WHERE s.pass_id = $1 AND s.candidate_id = $2 AND bs.status != 'spoiled'`,
      [lastPass.id, candidate.id]
    );
    const voteCount = parseInt(voteStr);
    const percentage = total > 0 ? (voteCount / total) * 100 : 0;
    const outcome = savedOutcomes[candidate.id] || null;

    const { rows: [result] } = await db.query(
      `INSERT INTO round_results (round_id, candidate_id, vote_count, percentage, outcome)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [roundId, candidate.id, voteCount, percentage.toFixed(5), outcome]
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

  // Get ALL candidates with their results (LEFT JOIN so candidates without votes still appear)
  const { rows: results } = await db.query(
    `SELECT c.id as candidate_id, c.name as candidate_name, c.display_order, c.status as candidate_status,
            COALESCE(rr.vote_count, 0) as vote_count,
            COALESCE(rr.percentage, 0) as percentage,
            rr.outcome, rr.id as result_id
     FROM candidates c
     LEFT JOIN round_results rr ON rr.candidate_id = c.id AND rr.round_id = $1
     WHERE c.race_id = $2
     ORDER BY COALESCE(rr.vote_count, 0) DESC, c.display_order`,
    [roundId, race.id]
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

/**
 * Get ballot-level reconciliation data across all complete passes for a round.
 * Returns per-ballot data with each pass's scan info and reconciliation status.
 */
async function getBallotReconciliation(roundId) {
  const { rows: passes } = await db.query(
    "SELECT * FROM passes WHERE round_id = $1 AND status = 'complete' ORDER BY pass_number",
    [roundId]
  );

  const { rows: [round] } = await db.query('SELECT * FROM rounds WHERE id = $1', [roundId]);
  const { rows: candidates } = await db.query(
    'SELECT * FROM candidates WHERE race_id = $1 ORDER BY display_order',
    [round.race_id]
  );

  // Get all scans across all complete passes for this round
  const { rows: scans } = await db.query(
    `SELECT s.id as scan_id, s.pass_id, s.ballot_serial_id, s.candidate_id,
            s.image_path, s.omr_confidence, s.omr_method, s.scanned_at,
            bs.serial_number, bs.status as ballot_status,
            c.name as candidate_name,
            p.pass_number
     FROM scans s
     JOIN ballot_serials bs ON bs.id = s.ballot_serial_id
     JOIN candidates c ON c.id = s.candidate_id
     JOIN passes p ON p.id = s.pass_id
     WHERE p.round_id = $1 AND p.status = 'complete'
     ORDER BY bs.serial_number, p.pass_number`,
    [roundId]
  );

  // Get existing reconciliation decisions
  const { rows: recons } = await db.query(
    'SELECT * FROM ballot_reconciliations WHERE round_id = $1 ORDER BY created_at DESC',
    [roundId]
  );
  // Map: ballot_serial_id -> latest reconciliation
  const reconMap = {};
  for (const r of recons) {
    if (!reconMap[r.ballot_serial_id]) reconMap[r.ballot_serial_id] = r;
  }

  // Group scans by serial number
  const ballotMap = {};
  for (const s of scans) {
    if (!ballotMap[s.serial_number]) {
      ballotMap[s.serial_number] = {
        serial_number: s.serial_number,
        ballot_serial_id: s.ballot_serial_id,
        ballot_status: s.ballot_status,
        passes: {},
      };
    }
    ballotMap[s.serial_number].passes[s.pass_number] = {
      scan_id: s.scan_id,
      pass_id: s.pass_id,
      candidate_id: s.candidate_id,
      candidate_name: s.candidate_name,
      image_path: s.image_path,
      omr_confidence: s.omr_confidence != null ? parseFloat(s.omr_confidence) : null,
      omr_method: s.omr_method,
    };
  }

  // Build ballot array with status
  const passNumbers = passes.map(p => p.pass_number);
  const ballots = Object.values(ballotMap).map(b => {
    const passVotes = passNumbers.map(pn => b.passes[pn]?.candidate_id).filter(v => v != null);
    const presentInAll = passNumbers.every(pn => b.passes[pn]);
    let status;
    if (!presentInAll) {
      status = 'missing_in_pass';
    } else if (new Set(passVotes).size <= 1) {
      status = 'agree';
    } else {
      status = 'disagree';
    }
    const recon = reconMap[b.ballot_serial_id] || null;
    return { ...b, status, reconciliation: recon };
  });

  ballots.sort((a, b) => a.serial_number.localeCompare(b.serial_number));

  const summary = {
    total: ballots.length,
    agree: ballots.filter(b => b.status === 'agree').length,
    disagree: ballots.filter(b => b.status === 'disagree').length,
    missing: ballots.filter(b => b.status === 'missing_in_pass').length,
    reconciled: ballots.filter(b => b.reconciliation != null).length,
    unreconciled: ballots.filter(b => b.reconciliation == null).length,
  };

  return { passes, candidates, ballots, summary };
}

/**
 * Auto-reconcile all ballots where every complete pass agrees on the same candidate.
 */
async function autoReconcile(roundId, reviewedBy) {
  // Find ballot_serial_ids that appear in all complete passes with the same candidate
  // and don't already have a reconciliation decision
  const { rows: agreeing } = await db.query(
    `SELECT s.ballot_serial_id
     FROM scans s
     JOIN passes p ON p.id = s.pass_id
     WHERE p.round_id = $1 AND p.status = 'complete'
       AND s.ballot_serial_id NOT IN (
         SELECT ballot_serial_id FROM ballot_reconciliations WHERE round_id = $1
       )
     GROUP BY s.ballot_serial_id
     HAVING COUNT(DISTINCT p.id) = (
       SELECT COUNT(*) FROM passes WHERE round_id = $1 AND status = 'complete'
     )
     AND COUNT(DISTINCT s.candidate_id) = 1`,
    [roundId]
  );

  if (agreeing.length > 0) {
    const values = agreeing.map((_, i) => `($1, $${i + 2}, 'pass_agree_auto', $${agreeing.length + 2})`).join(', ');
    const params = [roundId, ...agreeing.map(a => a.ballot_serial_id), reviewedBy || null];
    await db.query(
      `INSERT INTO ballot_reconciliations (round_id, ballot_serial_id, decision, reviewed_by)
       VALUES ${values}`,
      params
    );
  }

  // Count remaining disagreements
  const { rows: [{ count: remainingStr }] } = await db.query(
    `SELECT COUNT(DISTINCT s.ballot_serial_id) as count
     FROM scans s
     JOIN passes p ON p.id = s.pass_id
     WHERE p.round_id = $1 AND p.status = 'complete'
       AND s.ballot_serial_id NOT IN (
         SELECT ballot_serial_id FROM ballot_reconciliations WHERE round_id = $1
       )`,
    [roundId]
  );

  return { auto_reconciled: agreeing.length, remaining: parseInt(remainingStr) };
}

/**
 * Record a reconciliation decision for a single ballot.
 * If accepting a specific pass, update the scan to match that pass's vote.
 */
async function recordReconciliation({ roundId, ballotSerialId, decision, acceptedPassId, reviewedBy, notes }) {
  const { rows: [recon] } = await db.query(
    `INSERT INTO ballot_reconciliations (round_id, ballot_serial_id, decision, accepted_pass_id, reviewed_by, notes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [roundId, ballotSerialId, decision, acceptedPassId || null, reviewedBy, notes || null]
  );

  // If accepting a specific pass, ensure the latest pass's scan matches the accepted pass's vote
  if (decision === 'accept_pass' && acceptedPassId) {
    const { rows: [acceptedScan] } = await db.query(
      'SELECT candidate_id FROM scans WHERE pass_id = $1 AND ballot_serial_id = $2',
      [acceptedPassId, ballotSerialId]
    );

    if (acceptedScan) {
      // Get the latest pass for this round
      const { rows: [latestPass] } = await db.query(
        "SELECT * FROM passes WHERE round_id = $1 AND status = 'complete' ORDER BY pass_number DESC LIMIT 1",
        [roundId]
      );

      if (latestPass) {
        const { rows: [latestScan] } = await db.query(
          'SELECT * FROM scans WHERE pass_id = $1 AND ballot_serial_id = $2',
          [latestPass.id, ballotSerialId]
        );

        if (latestScan && latestScan.candidate_id !== acceptedScan.candidate_id) {
          // Update the latest scan to match the accepted pass
          await db.query(
            `UPDATE scans SET candidate_id = $1, omr_method = 'manual_correction'
             WHERE id = $2`,
            [acceptedScan.candidate_id, latestScan.id]
          );

          // Log the change
          try {
            await db.query(
              `INSERT INTO vote_changes (scan_id, old_candidate_id, new_candidate_id, changed_by, reason)
               VALUES ($1, $2, $3, $4, $5)`,
              [latestScan.id, latestScan.candidate_id, acceptedScan.candidate_id,
               reviewedBy, `Reconciliation: accepted Pass ${acceptedPassId} result`]
            );
          } catch (e) { /* vote_changes may not exist */ }
        }
      }
    }
  }

  return recon;
}

module.exports = {
  getComparison, computeResults, confirmRound, releaseRound, getChairPreview, getChairDecision,
  getBallotReconciliation, autoReconcile, recordReconciliation,
};
