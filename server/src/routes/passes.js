const { Router } = require('express');
const db = require('../db');
const { getSession, requireSuperAdmin } = require('../middleware/auth');

const router = Router();

/**
 * Middleware: require super_admin for pass lifecycle actions.
 * Applied inline to create/complete/delete/reopen pass routes.
 */
function requireSuperAdminForPass(req, res, next) {
  const session = getSession(req);
  if (!session || session.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only Super Admin can manage passes' });
  }
  req.session = session;
  next();
}

// GET /api/rounds/:id/detail — Round data for scanner (no auth, includes candidates + ballot boxes)
router.get('/rounds/:id/detail', async (req, res) => {
  try {
    const { rows: [round] } = await db.query('SELECT * FROM rounds WHERE id = $1', [req.params.id]);
    if (!round) return res.status(404).json({ error: 'Round not found' });

    const { rows: [race] } = await db.query('SELECT * FROM races WHERE id = $1', [round.race_id]);
    const { rows: [election] } = await db.query('SELECT * FROM elections WHERE id = $1', [race.election_id]);
    const { rows: candidates } = await db.query(
      'SELECT * FROM candidates WHERE race_id = $1 ORDER BY display_order', [round.race_id]
    );
    const { rows: ballotBoxes } = await db.query(
      'SELECT * FROM ballot_boxes WHERE election_id = $1 ORDER BY created_at', [race.election_id]
    );

    res.json({ ...round, race, election, candidates, ballot_boxes: ballotBoxes });
  } catch (err) {
    console.error('Round detail error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/rounds/:id/passes — Create a pass (auto-numbers) — Super Admin only
router.post('/rounds/:id/passes', requireSuperAdminForPass, async (req, res) => {
  try {
    const roundId = parseInt(req.params.id);

    // Verify round exists and is in scanning state
    const { rows: [round] } = await db.query('SELECT * FROM rounds WHERE id = $1', [roundId]);
    if (!round) return res.status(404).json({ error: 'Round not found' });

    // Auto-set round to tallying if pending_needs_action or ready
    if (['pending_needs_action', 'ready'].includes(round.status)) {
      // Gate: previous round must be finalized+published or canceled
      if (round.round_number > 1) {
        const { rows: [prevRound] } = await db.query(
          'SELECT * FROM rounds WHERE race_id = $1 AND round_number = $2 ORDER BY round_number DESC LIMIT 1',
          [round.race_id, round.round_number - 1]
        );
        if (prevRound && prevRound.status !== 'canceled' &&
            !(prevRound.status === 'round_finalized' && prevRound.published_at)) {
          return res.status(400).json({
            error: `Cannot start scanning — previous round (Round ${prevRound.round_number}) must be finalized and published first.`
          });
        }
      }
      await db.query("UPDATE rounds SET status = 'tallying' WHERE id = $1", [roundId]);
    }

    // Get next pass number
    const { rows: [{ max }] } = await db.query(
      "SELECT COALESCE(MAX(pass_number), 0) as max FROM passes WHERE round_id = $1 AND status != 'deleted'",
      [roundId]
    );

    const { rows: [pass] } = await db.query(
      `INSERT INTO passes (round_id, pass_number) VALUES ($1, $2) RETURNING *`,
      [roundId, max + 1]
    );
    res.status(201).json(pass);
  } catch (err) {
    console.error('Create pass error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/passes/:id/complete — Mark pass as complete — Super Admin only
router.put('/passes/:id/complete', requireSuperAdminForPass, async (req, res) => {
  try {
    const { rows: [pass] } = await db.query(
      `UPDATE passes SET status = 'complete', completed_at = NOW()
       WHERE id = $1 AND status = 'active' RETURNING *`,
      [req.params.id]
    );
    if (!pass) return res.status(404).json({ error: 'Pass not found or already complete' });

    // Broadcast pass:complete via WebSocket
    const io = req.app.get('io');
    if (io) io.emit('pass:complete', { pass_id: pass.id, round_id: pass.round_id, pass_number: pass.pass_number });

    res.json(pass);
  } catch (err) {
    console.error('Complete pass error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/passes/:id — Delete pass (Super Admin only, double-verify with PIN)
// Resets ballot serials to 'unused' so the pass can be rescanned.
// Blocked if round or race is finalized (must reverse finalization first).
router.delete('/passes/:id', requireSuperAdminForPass, async (req, res) => {
  try {
    const { rows: [pass] } = await db.query('SELECT * FROM passes WHERE id = $1', [req.params.id]);
    if (!pass) return res.status(404).json({ error: 'Pass not found' });

    // Check round is not finalized or canceled
    const { rows: [round] } = await db.query('SELECT * FROM rounds WHERE id = $1', [pass.round_id]);
    if (['round_finalized', 'canceled'].includes(round.status)) {
      return res.status(400).json({ error: 'Cannot delete pass — round is finalized or canceled. Reverse finalization first.' });
    }

    // Check race is not finalized
    const { rows: [race] } = await db.query('SELECT * FROM races WHERE id = $1', [round.race_id]);
    if (race.status === 'results_finalized') {
      return res.status(400).json({ error: 'Cannot delete pass — race is finalized. Reverse race finalization first.' });
    }

    // Double-verify: require PIN confirmation
    const { deleted_reason, confirm_pin } = req.body || {};
    if (!confirm_pin) {
      return res.status(400).json({ error: 'PIN confirmation required to delete a pass (confirm_pin)' });
    }
    const { verifyPin } = require('../middleware/auth');
    const pinValid = await verifyPin(req.session.user_id, confirm_pin);
    if (!pinValid) {
      return res.status(403).json({ error: 'PIN verification failed' });
    }

    if (!deleted_reason || !deleted_reason.trim()) {
      return res.status(400).json({ error: 'A reason is required when deleting a pass' });
    }

    // Get all ballot_serial_ids from scans in this pass to reset them
    const { rows: scannedSerials } = await db.query(
      'SELECT DISTINCT ballot_serial_id FROM scans WHERE pass_id = $1',
      [req.params.id]
    );

    // Soft-delete the pass
    await db.query(
      `UPDATE passes SET status = 'deleted', deleted_reason = $1 WHERE id = $2`,
      [deleted_reason, req.params.id]
    );

    // Delete associated scans
    await db.query('DELETE FROM scans WHERE pass_id = $1', [req.params.id]);

    // Reset ballot serials back to 'unused' if they aren't scanned in another active pass
    for (const { ballot_serial_id } of scannedSerials) {
      const { rows: [otherScan] } = await db.query(
        `SELECT s.id FROM scans s JOIN passes p ON p.id = s.pass_id
         WHERE s.ballot_serial_id = $1 AND p.status != 'deleted' LIMIT 1`,
        [ballot_serial_id]
      );
      if (!otherScan) {
        await db.query(
          "UPDATE ballot_serials SET status = 'unused' WHERE id = $1 AND status = 'counted'",
          [ballot_serial_id]
        );
      }
    }

    // Record audit entry in status_transitions for the PDF
    await db.query(
      `INSERT INTO status_transitions (entity_type, entity_id, from_status, to_status, changed_by)
       VALUES ('pass_deleted', $1, 'active', 'deleted', $2)`,
      [pass.id, `${req.session.name}: ${deleted_reason}`]
    );

    const io = req.app.get('io');
    if (io) io.emit('pass:deleted', { pass_id: pass.id, round_id: pass.round_id });

    res.json({ message: `Pass ${pass.pass_number} deleted — ${scannedSerials.length} ballot serials reset to unused` });
  } catch (err) {
    console.error('Delete pass error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/passes/:id/reopen — Reopen a completed pass (Super Admin only)
// Allows additional scanning into a pass that was previously completed.
router.put('/passes/:id/reopen', requireSuperAdminForPass, async (req, res) => {
  try {
    const { rows: [pass] } = await db.query('SELECT * FROM passes WHERE id = $1', [req.params.id]);
    if (!pass) return res.status(404).json({ error: 'Pass not found' });
    if (pass.status !== 'complete') {
      return res.status(400).json({ error: `Can only reopen a completed pass (current: ${pass.status})` });
    }

    // Check round is not finalized
    const { rows: [round] } = await db.query('SELECT * FROM rounds WHERE id = $1', [pass.round_id]);
    if (['round_finalized', 'canceled'].includes(round.status)) {
      return res.status(400).json({ error: 'Cannot reopen pass — round is finalized or canceled. Reverse finalization first.' });
    }

    const { reason } = req.body || {};
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'A reason is required to reopen a pass' });
    }

    await db.query(
      `UPDATE passes SET status = 'active', completed_at = NULL WHERE id = $1`,
      [req.params.id]
    );

    // Record audit entry for the PDF
    await db.query(
      `INSERT INTO status_transitions (entity_type, entity_id, from_status, to_status, changed_by)
       VALUES ('pass_reopened', $1, 'complete', 'active', $2)`,
      [pass.id, `${req.session.name}: ${reason}`]
    );

    const io = req.app.get('io');
    if (io) io.emit('pass:reopened', { pass_id: pass.id, round_id: pass.round_id, pass_number: pass.pass_number });

    res.json({ message: `Pass ${pass.pass_number} reopened`, pass_id: pass.id });
  } catch (err) {
    console.error('Reopen pass error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/rounds/:id/passes — List passes with scan counts.
// scan_count = rows in `scans` (successfully-counted votes).
// upload_count = rows in `scan_uploads` (every agent upload regardless of outcome,
// including flagged, duplicate, wrong_round, etc.) — used for the Total Scans display.
router.get('/rounds/:id/passes', async (req, res) => {
  try {
    const { rows: passes } = await db.query(
      `SELECT p.*,
         (SELECT COUNT(*) FROM scans s WHERE s.pass_id = p.id)::int AS scan_count,
         (SELECT COUNT(*) FROM scan_uploads su WHERE su.pass_id = p.id)::int AS upload_count
       FROM passes p
       WHERE p.round_id = $1 AND p.status != 'deleted'
       ORDER BY p.pass_number`,
      [req.params.id]
    );
    res.json(passes);
  } catch (err) {
    console.error('List passes error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/rounds/:id/reconciliation-counts — Images needing reconciliation, by station.
// Unresolved = reviewed_ballots.outcome IS NULL. Grouped by the originating station.
router.get('/rounds/:id/reconciliation-counts', async (req, res) => {
  try {
    const roundId = parseInt(req.params.id);
    const { rows } = await db.query(
      `SELECT COALESCE(station_id, 'unknown') AS station_id, COUNT(*)::int AS pending
       FROM reviewed_ballots
       WHERE round_id = $1 AND outcome IS NULL
       GROUP BY COALESCE(station_id, 'unknown')
       ORDER BY station_id`,
      [roundId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Reconciliation counts error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/rounds/:id/station-counts — Per-station, per-pass upload counts.
// Counts every image the agent uploaded regardless of classification.
router.get('/rounds/:id/station-counts', async (req, res) => {
  try {
    const roundId = parseInt(req.params.id);
    const { rows } = await db.query(
      `SELECT
         su.station_id,
         su.pass_id,
         p.pass_number,
         p.status AS pass_status,
         COUNT(*)::int AS uploads,
         SUM(CASE WHEN su.outcome = 'counted' THEN 1 ELSE 0 END)::int AS counted,
         SUM(CASE WHEN su.outcome != 'counted' THEN 1 ELSE 0 END)::int AS flagged
       FROM scan_uploads su
       LEFT JOIN passes p ON su.pass_id = p.id
       WHERE su.round_id = $1
       GROUP BY su.station_id, su.pass_id, p.pass_number, p.status
       ORDER BY p.pass_number NULLS LAST, su.station_id`,
      [roundId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Station counts error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
