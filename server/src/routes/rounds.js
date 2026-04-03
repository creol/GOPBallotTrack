const { Router } = require('express');
const db = require('../db');
const { generateSerials } = require('../services/serialGenerator');

const router = Router();

// POST /api/admin/races/:id/rounds — Create round (paper_color required)
// Auto-generates SNs using the race's ballot_count
router.post('/races/:id/rounds', async (req, res) => {
  try {
    const { paper_color } = req.body;
    if (!paper_color) return res.status(400).json({ error: 'paper_color is required' });

    const raceId = parseInt(req.params.id);

    // Get race to check ballot_count
    const { rows: [race] } = await db.query('SELECT * FROM races WHERE id = $1', [raceId]);
    if (!race) return res.status(404).json({ error: 'Race not found' });

    // Get next round_number
    const { rows: [{ max }] } = await db.query(
      'SELECT COALESCE(MAX(round_number), 0) as max FROM rounds WHERE race_id = $1',
      [raceId]
    );

    const { rows: [round] } = await db.query(
      `INSERT INTO rounds (race_id, round_number, paper_color)
       VALUES ($1, $2, $3) RETURNING *`,
      [raceId, max + 1, paper_color]
    );

    // Auto-generate SNs if the race has a ballot_count set
    let serialCount = 0;
    if (race.ballot_count && race.ballot_count > 0) {
      const serials = await generateSerials(round.id, race.ballot_count);
      serialCount = serials.length;
    }

    res.status(201).json({ ...round, serial_count: serialCount });
  } catch (err) {
    console.error('Create round error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/rounds/:id — Get round detail with passes and results
router.get('/rounds/:id', async (req, res) => {
  try {
    const { rows: [round] } = await db.query(
      'SELECT * FROM rounds WHERE id = $1', [req.params.id]
    );
    if (!round) return res.status(404).json({ error: 'Round not found' });

    const { rows: passes } = await db.query(
      'SELECT * FROM passes WHERE round_id = $1 ORDER BY pass_number',
      [round.id]
    );

    const { rows: results } = await db.query(
      `SELECT rr.*, c.name as candidate_name
       FROM round_results rr
       JOIN candidates c ON c.id = rr.candidate_id
       WHERE rr.round_id = $1
       ORDER BY rr.vote_count DESC`,
      [round.id]
    );

    // Get race info for context
    const { rows: [race] } = await db.query(
      'SELECT * FROM races WHERE id = $1', [round.race_id]
    );

    // Get ballot serial count
    const { rows: [{ count: serialCount }] } = await db.query(
      'SELECT COUNT(*) as count FROM ballot_serials WHERE round_id = $1', [round.id]
    );

    res.json({ ...round, passes, results, race, serial_count: parseInt(serialCount) });
  } catch (err) {
    console.error('Get round error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
