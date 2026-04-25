const { Router } = require('express');
const {
  getComparison,
  confirmRound,
  releaseRound,
  getChairPreview,
  getChairDecision,
  getBallotReconciliation,
  autoReconcile,
  recordReconciliation,
} = require('../services/confirmationService');
const db = require('../db');
const { requireSuperAdminPin } = require('../middleware/auth');

const router = Router();

// GET /api/passes/:id/ballots — List all scanned ballots in a pass with details
router.get('/passes/:id/ballots', async (req, res) => {
  try {
    const passId = parseInt(req.params.id);
    // Get the round_id for this pass so client can detect wrong-round ballots
    const { rows: [passInfo] } = await db.query('SELECT round_id FROM passes WHERE id = $1', [passId]);
    const passRoundId = passInfo?.round_id;

    const { rows } = await db.query(
      `SELECT s.id as scan_id, s.ballot_serial_id, s.candidate_id, s.image_path,
              s.omr_confidence, s.omr_method, s.scanned_at,
              bs.serial_number, bs.round_id as ballot_round_id, bs.status as ballot_status,
              c.name as candidate_name
       FROM scans s
       JOIN ballot_serials bs ON bs.id = s.ballot_serial_id
       JOIN candidates c ON c.id = s.candidate_id
       WHERE s.pass_id = $1
       ORDER BY bs.serial_number`,
      [passId]
    );

    // Tag each ballot with whether it belongs to this round
    for (const row of rows) {
      row.wrong_round = passRoundId && row.ballot_round_id !== passRoundId;
    }
    res.json(rows);
  } catch (err) {
    console.error('List pass ballots error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/scans/:id/spoil — Spoil a ballot (remove scan, mark serial as spoiled)
router.put('/scans/:id/spoil', async (req, res) => {
  try {
    const { spoiled_by, reason } = req.body;
    if (!spoiled_by) return res.status(400).json({ error: 'spoiled_by (your name) is required' });

    const { rows: [scan] } = await db.query(
      `SELECT s.*, bs.serial_number, bs.round_id
       FROM scans s
       JOIN ballot_serials bs ON bs.id = s.ballot_serial_id
       WHERE s.id = $1`,
      [req.params.id]
    );
    if (!scan) return res.status(404).json({ error: 'Scan not found' });

    // Mark the serial as spoiled
    await db.query("UPDATE ballot_serials SET status = 'spoiled' WHERE id = $1", [scan.ballot_serial_id]);

    // Delete the scan from all passes for this ballot serial
    await db.query('DELETE FROM scans WHERE ballot_serial_id = $1', [scan.ballot_serial_id]);

    // Log the spoil in vote_changes
    try {
      await db.query(
        `INSERT INTO vote_changes (scan_id, old_candidate_id, new_candidate_id, changed_by, reason)
         VALUES ($1, $2, NULL, $3, $4)`,
        [parseInt(req.params.id), scan.candidate_id, spoiled_by, `SPOILED: ${reason || 'No reason given'}`]
      );
    } catch {}

    res.json({ message: `Ballot ${scan.serial_number} spoiled`, serial_number: scan.serial_number });
  } catch (err) {
    console.error('Spoil ballot error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/scans/:id/change-vote — Change the candidate vote on a scan
router.put('/scans/:id/change-vote', async (req, res) => {
  try {
    const { candidate_id, changed_by, reason } = req.body;
    if (!candidate_id) return res.status(400).json({ error: 'candidate_id is required' });
    if (!changed_by) return res.status(400).json({ error: 'changed_by (your name) is required' });

    // Get the current vote before changing
    const { rows: [current] } = await db.query('SELECT candidate_id FROM scans WHERE id = $1', [req.params.id]);
    if (!current) return res.status(404).json({ error: 'Scan not found' });

    // Update the vote
    const { rows: [scan] } = await db.query(
      `UPDATE scans SET candidate_id = $1, omr_method = 'manual_correction', scanned_by = $2
       WHERE id = $3 RETURNING *`,
      [candidate_id, `Corrected:${changed_by}`, req.params.id]
    );

    // Log the change
    await db.query(
      `INSERT INTO vote_changes (scan_id, old_candidate_id, new_candidate_id, changed_by, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.params.id, current.candidate_id, candidate_id, changed_by, reason || null]
    );

    res.json({ message: 'Vote corrected', scan });
  } catch (err) {
    console.error('Change vote error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/rounds/:id/candidate-outcomes — Save candidate outcomes for a round
router.put('/rounds/:id/candidate-outcomes', async (req, res) => {
  try {
    const roundId = parseInt(req.params.id);
    const { outcomes } = req.body; // { candidateId: 'advance', candidateId2: 'eliminated', ... }
    if (!outcomes || typeof outcomes !== 'object') {
      return res.status(400).json({ error: 'outcomes object is required' });
    }

    for (const [candidateId, outcome] of Object.entries(outcomes)) {
      // Try update first, insert if no row exists
      const { rowCount } = await db.query(
        'UPDATE round_results SET outcome = $1 WHERE round_id = $2 AND candidate_id = $3',
        [outcome || null, roundId, parseInt(candidateId)]
      );
      if (rowCount === 0 && outcome) {
        // No round_results row — insert one with 0 votes
        await db.query(
          'INSERT INTO round_results (round_id, candidate_id, vote_count, percentage, outcome) VALUES ($1, $2, 0, 0, $3)',
          [roundId, parseInt(candidateId), outcome]
        );
      }
    }

    res.json({ message: 'Candidate outcomes saved' });
  } catch (err) {
    console.error('Save candidate outcomes error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/rounds/:id/ballot-reconciliation — Per-ballot cross-pass comparison with images
router.get('/rounds/:id/ballot-reconciliation', async (req, res) => {
  try {
    const data = await getBallotReconciliation(parseInt(req.params.id));
    res.json(data);
  } catch (err) {
    console.error('Ballot reconciliation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rounds/:id/auto-reconcile — Auto-confirm all agreeing ballots
router.post('/rounds/:id/auto-reconcile', async (req, res) => {
  try {
    const { reviewed_by } = req.body;
    const result = await autoReconcile(parseInt(req.params.id), reviewed_by);
    res.json(result);
  } catch (err) {
    console.error('Auto-reconcile error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rounds/:id/reconcile — Submit a single ballot reconciliation decision
router.post('/rounds/:id/reconcile', async (req, res) => {
  try {
    const { ballot_serial_id, decision, accepted_pass_id, reviewed_by, notes } = req.body;
    if (!ballot_serial_id) return res.status(400).json({ error: 'ballot_serial_id is required' });
    if (!decision) return res.status(400).json({ error: 'decision is required' });
    if (!reviewed_by) return res.status(400).json({ error: 'reviewed_by is required' });

    const recon = await recordReconciliation({
      roundId: parseInt(req.params.id),
      ballotSerialId: ballot_serial_id,
      decision,
      acceptedPassId: accepted_pass_id,
      reviewedBy: reviewed_by,
      notes,
    });
    res.json(recon);
  } catch (err) {
    console.error('Reconcile error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rounds/:id/reconcile/undo — Reverse the most recent reconciliation for a ballot
// If the decision was accept_pass and mutated a scan's candidate_id, restore it from vote_changes.
router.post('/rounds/:id/reconcile/undo', async (req, res) => {
  const client = await db.pool.connect();
  try {
    const roundId = parseInt(req.params.id);
    const { ballot_serial_id, reviewed_by } = req.body;
    if (!ballot_serial_id) return res.status(400).json({ error: 'ballot_serial_id is required' });
    if (!reviewed_by) return res.status(400).json({ error: 'reviewed_by is required' });

    await client.query('BEGIN');

    // Latest reconciliation for this ballot
    const { rows: [recon] } = await client.query(
      `SELECT * FROM ballot_reconciliations
       WHERE round_id = $1 AND ballot_serial_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [roundId, ballot_serial_id]
    );
    if (!recon) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'No reconciliation to undo for this ballot' });
    }

    // If the reconciliation rewrote a scan's candidate_id, roll that back from vote_changes.
    if (recon.decision === 'accept_pass' && recon.accepted_pass_id) {
      const { rows: [latestPass] } = await client.query(
        "SELECT id FROM passes WHERE round_id = $1 AND status IN ('complete', 'active') ORDER BY pass_number DESC LIMIT 1",
        [roundId]
      );
      if (latestPass) {
        const { rows: [latestScan] } = await client.query(
          'SELECT id FROM scans WHERE pass_id = $1 AND ballot_serial_id = $2',
          [latestPass.id, ballot_serial_id]
        );
        if (latestScan) {
          const { rows: [change] } = await client.query(
            `SELECT * FROM vote_changes
             WHERE scan_id = $1 AND changed_at >= $2
             ORDER BY changed_at DESC LIMIT 1`,
            [latestScan.id, recon.created_at]
          );
          if (change) {
            await client.query(
              `UPDATE scans SET candidate_id = $1, omr_method = 'manual_correction' WHERE id = $2`,
              [change.old_candidate_id, latestScan.id]
            );
            await client.query(
              `INSERT INTO vote_changes (scan_id, old_candidate_id, new_candidate_id, changed_by, reason)
               VALUES ($1, $2, $3, $4, $5)`,
              [latestScan.id, change.new_candidate_id, change.old_candidate_id, reviewed_by,
               `Undo reconciliation (recon #${recon.id})`]
            );
          }
        }
      }
    }

    await client.query('DELETE FROM ballot_reconciliations WHERE id = $1', [recon.id]);
    await client.query('COMMIT');

    res.json({ message: 'Reconciliation undone', undone: recon });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Undo reconcile error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /api/rounds/:id/reject-wrong-round — Bulk reject all wrong-round ballots
router.post('/rounds/:id/reject-wrong-round', async (req, res) => {
  try {
    const roundId = parseInt(req.params.id);
    const { rejected_by } = req.body;
    if (!rejected_by) return res.status(400).json({ error: 'rejected_by is required' });

    // Find all unresolved wrong_round reviewed_ballots for this round
    const { rows: reviews } = await db.query(
      `SELECT rb.id, rb.original_serial_id, rb.pass_id
       FROM reviewed_ballots rb
       WHERE rb.round_id = $1
         AND rb.flag_reason = 'wrong_round'
         AND rb.outcome IS NULL`,
      [roundId]
    );

    if (reviews.length === 0) {
      return res.json({ message: 'No unresolved wrong-round ballots found', count: 0, scans_removed: 0 });
    }

    let deletedScans = 0;
    for (const review of reviews) {
      await db.query(
        `UPDATE reviewed_ballots SET outcome = 'rejected', reviewed_by = $1, reviewed_at = NOW()
         WHERE id = $2`,
        [rejected_by, review.id]
      );
      if (review.pass_id && review.original_serial_id) {
        const { rowCount } = await db.query(
          "DELETE FROM scans WHERE pass_id = $1 AND ballot_serial_id = $2 AND omr_method = 'wrong_round_pending'",
          [review.pass_id, review.original_serial_id]
        );
        deletedScans += rowCount;
      }
    }

    const io = req.app.get('io');
    if (io) io.emit('scan:bulk_rejected', { round_id: roundId, count: reviews.length });

    res.json({ message: `Rejected ${reviews.length} wrong-round ballots`, count: reviews.length, scans_removed: deletedScans });
  } catch (err) {
    console.error('Bulk reject wrong-round error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/rounds/:id/comparison — Compare all passes side-by-side
router.get('/rounds/:id/comparison', async (req, res) => {
  try {
    const data = await getComparison(parseInt(req.params.id));
    res.json(data);
  } catch (err) {
    console.error('Comparison error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rounds/:id/confirm — Election Judge confirms the round.
// Always requires a super-admin PIN. The conditional gate that used to live
// here let Confirmation.jsx finalize a round with just a typed name, which
// turned a "Finalize Round" flow into a no-PIN action and contradicted the
// rule that nothing finalizes without a valid super-admin PIN.
router.post('/rounds/:id/confirm', requireSuperAdminPin, actuallyConfirmRound);

async function actuallyConfirmRound(req, res) {
  try {
    const { confirmed_by_name } = req.body;
    if (!confirmed_by_name) {
      return res.status(400).json({ error: 'confirmed_by_name is required' });
    }

    const results = await confirmRound({
      roundId: parseInt(req.params.id),
      confirmedByName: confirmed_by_name,
      isOverride: false,
      overrideNotes: null,
    });

    const io = req.app.get('io');
    if (io) io.emit('round:confirmed', { round_id: parseInt(req.params.id) });

    res.json({ message: 'Round confirmed', results });
  } catch (err) {
    console.error('Confirm error:', err);
    const status = err.message.includes('required') ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
}

// POST /api/rounds/:id/confirm-override — Election Judge overrides a mismatch.
// Same hard PIN gate as /confirm — overrides are even more sensitive, so we
// never accept them without a fresh super-admin PIN.
router.post('/rounds/:id/confirm-override', requireSuperAdminPin, actuallyConfirmOverride);

async function actuallyConfirmOverride(req, res) {
  try {
    const { confirmed_by_name, override_notes } = req.body;
    if (!confirmed_by_name) {
      return res.status(400).json({ error: 'confirmed_by_name is required' });
    }
    if (!override_notes || !override_notes.trim()) {
      return res.status(400).json({ error: 'override_notes are required for overrides' });
    }

    const results = await confirmRound({
      roundId: parseInt(req.params.id),
      confirmedByName: confirmed_by_name,
      isOverride: true,
      overrideNotes: override_notes,
    });

    const io = req.app.get('io');
    if (io) io.emit('round:confirmed', { round_id: parseInt(req.params.id) });

    res.json({ message: 'Round confirmed with override', results });
  } catch (err) {
    console.error('Confirm override error:', err);
    const status = err.message.includes('required') ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
}

// GET /api/rounds/:id/chair-preview — What the public will see
router.get('/rounds/:id/chair-preview', async (req, res) => {
  try {
    const data = await getChairPreview(parseInt(req.params.id));
    res.json(data);
  } catch (err) {
    console.error('Chair preview error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rounds/:id/release — Chair approves public release
router.post('/rounds/:id/release', async (req, res) => {
  try {
    const { released_by_name } = req.body;
    if (!released_by_name) {
      return res.status(400).json({ error: 'released_by_name is required' });
    }

    await releaseRound({
      roundId: parseInt(req.params.id),
      releasedByName: released_by_name,
    });

    const io = req.app.get('io');
    if (io) io.emit('round:released', { round_id: parseInt(req.params.id) });

    res.json({ message: 'Round released to public' });
  } catch (err) {
    console.error('Release error:', err);
    const status = err.message.includes('must be') ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/rounds/:id/chair-decision — Chair decision screen data
router.get('/rounds/:id/chair-decision', async (req, res) => {
  try {
    const data = await getChairDecision(parseInt(req.params.id));
    res.json(data);
  } catch (err) {
    console.error('Chair decision error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
