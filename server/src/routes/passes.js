const { Router } = require('express');
const db = require('../db');

const router = Router();

// POST /api/rounds/:id/passes — Create a pass (auto-numbers)
router.post('/rounds/:id/passes', async (req, res) => {
  try {
    const roundId = parseInt(req.params.id);

    // Verify round exists and is in scanning state
    const { rows: [round] } = await db.query('SELECT * FROM rounds WHERE id = $1', [roundId]);
    if (!round) return res.status(404).json({ error: 'Round not found' });

    // Auto-set round to scanning if pending
    if (round.status === 'pending') {
      await db.query("UPDATE rounds SET status = 'scanning' WHERE id = $1", [roundId]);
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

// PUT /api/passes/:id/complete — Mark pass as complete
router.put('/passes/:id/complete', async (req, res) => {
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

// DELETE /api/passes/:id — Delete pass (only before round confirmation)
router.delete('/passes/:id', async (req, res) => {
  try {
    const { rows: [pass] } = await db.query('SELECT * FROM passes WHERE id = $1', [req.params.id]);
    if (!pass) return res.status(404).json({ error: 'Pass not found' });

    // Check round is not confirmed
    const { rows: [round] } = await db.query('SELECT * FROM rounds WHERE id = $1', [pass.round_id]);
    if (['confirmed', 'pending_release', 'released'].includes(round.status)) {
      return res.status(400).json({ error: 'Cannot delete pass after round confirmation' });
    }

    const { deleted_reason } = req.body || {};
    await db.query(
      `UPDATE passes SET status = 'deleted', deleted_reason = $1 WHERE id = $2`,
      [deleted_reason || null, req.params.id]
    );

    // Delete associated scans
    await db.query('DELETE FROM scans WHERE pass_id = $1', [req.params.id]);

    res.json({ message: 'Pass deleted' });
  } catch (err) {
    console.error('Delete pass error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/rounds/:id/passes — List passes with scan counts
router.get('/rounds/:id/passes', async (req, res) => {
  try {
    const { rows: passes } = await db.query(
      `SELECT p.*, (SELECT COUNT(*) FROM scans s WHERE s.pass_id = p.id) as scan_count
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

module.exports = router;
