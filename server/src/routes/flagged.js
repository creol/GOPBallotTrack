const { Router } = require('express');
const db = require('../db');

const router = Router();

// GET /api/rounds/:roundId/flagged — List flagged ballots for a round
router.get('/rounds/:roundId/flagged', async (req, res) => {
  try {
    const showAll = req.query.all === 'true';
    const whereClause = showAll
      ? 'WHERE fb.round_id = $1'
      : 'WHERE fb.round_id = $1 AND fb.review_decision IS NULL';

    const { rows } = await db.query(
      `SELECT fb.id, fb.round_id, fb.pass_id, fb.flag_reason, fb.image_path,
              fb.omr_scores, fb.review_decision, fb.review_candidate_id,
              fb.review_notes, fb.reviewed_by, fb.created_at, fb.reviewed_at,
              bs.serial_number
       FROM flagged_ballots fb
       LEFT JOIN ballot_serials bs ON bs.id = fb.ballot_serial_id
       ${whereClause}
       ORDER BY fb.created_at DESC`,
      [req.params.roundId]
    );
    res.json(rows);
  } catch (err) {
    console.error('List flagged ballots error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/flagged/:id/review — Review a flagged ballot
router.post('/flagged/:id/review', async (req, res) => {
  try {
    const { reviewed_by, decision, candidate_id, notes } = req.body;
    if (!reviewed_by) return res.status(400).json({ error: 'reviewed_by is required' });
    if (!decision || !['counted', 'spoiled', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be counted, spoiled, or rejected' });
    }
    if (decision === 'counted' && !candidate_id) {
      return res.status(400).json({ error: 'candidate_id is required when decision is counted' });
    }

    // Get the flagged ballot
    const { rows: [flagged] } = await db.query(
      'SELECT * FROM flagged_ballots WHERE id = $1', [req.params.id]
    );
    if (!flagged) return res.status(404).json({ error: 'Flagged ballot not found' });

    // Update the flagged record
    await db.query(
      `UPDATE flagged_ballots SET
        review_decision = $1, review_candidate_id = $2, review_notes = $3,
        reviewed_by = $4, reviewed_at = NOW()
       WHERE id = $5`,
      [decision, candidate_id || null, notes || null, reviewed_by, req.params.id]
    );

    // Get serial number for events
    const { rows: [bs] } = await db.query(
      'SELECT serial_number FROM ballot_serials WHERE id = $1', [flagged.ballot_serial_id]
    );
    const serialNumber = bs?.serial_number || 'unknown';

    if (decision === 'counted') {
      // Insert into scans table
      await db.query(
        `INSERT INTO scans (pass_id, ballot_serial_id, candidate_id, scanned_by, image_path, omr_method)
         VALUES ($1, $2, $3, $4, $5, 'manual_review')`,
        [flagged.pass_id, flagged.ballot_serial_id, candidate_id, `Review:${reviewed_by}`,
         flagged.image_path]
      );
      // Update ballot serial status
      await db.query(
        "UPDATE ballot_serials SET status = 'counted' WHERE id = $1",
        [flagged.ballot_serial_id]
      );
    } else if (decision === 'spoiled') {
      // Insert into spoiled_ballots
      await db.query(
        `INSERT INTO spoiled_ballots (round_id, ballot_serial_id, spoil_type, notes, image_path, reported_by)
         VALUES ($1, $2, 'intent_undermined', $3, $4, $5)`,
        [flagged.round_id, flagged.ballot_serial_id, notes || null,
         flagged.image_path, reviewed_by]
      );
      await db.query(
        "UPDATE ballot_serials SET status = 'spoiled' WHERE id = $1",
        [flagged.ballot_serial_id]
      );
    }
    // 'rejected' — no further action, just the review record

    // Emit WebSocket event
    const io = req.app.get('io');
    if (io) io.emit('scan:reviewed', { id: flagged.id, decision, serial_number: serialNumber });

    res.json({ message: `Ballot ${serialNumber} reviewed as ${decision}` });
  } catch (err) {
    console.error('Review flagged ballot error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
