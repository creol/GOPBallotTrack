const { Router } = require('express');
const db = require('../db');

const router = Router();

// POST /api/admin/elections/:id/races — Create race
router.post('/elections/:id/races', async (req, res) => {
  try {
    const { name, threshold_type, threshold_value } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    // Get next display_order
    const { rows: [{ max }] } = await db.query(
      'SELECT COALESCE(MAX(display_order), 0) as max FROM races WHERE election_id = $1',
      [req.params.id]
    );

    const { rows: [race] } = await db.query(
      `INSERT INTO races (election_id, name, threshold_type, threshold_value, display_order)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.id, name, threshold_type || 'majority', threshold_value || null, max + 1]
    );
    res.status(201).json(race);
  } catch (err) {
    console.error('Create race error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/elections/:id/races — List races for election
router.get('/elections/:id/races', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM races WHERE election_id = $1 ORDER BY display_order',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('List races error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/races/:id — Update race
router.put('/races/:id', async (req, res) => {
  try {
    const { name, threshold_type, threshold_value } = req.body;
    const { rows: [race] } = await db.query(
      `UPDATE races SET
        name = COALESCE($1, name),
        threshold_type = COALESCE($2, threshold_type),
        threshold_value = COALESCE($3, threshold_value)
       WHERE id = $4 RETURNING *`,
      [name, threshold_type, threshold_value, req.params.id]
    );
    if (!race) return res.status(404).json({ error: 'Race not found' });
    res.json(race);
  } catch (err) {
    console.error('Update race error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/races/:id/candidates — List candidates for race
router.get('/races/:id/candidates', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM candidates WHERE race_id = $1 ORDER BY display_order',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('List candidates error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/races/:id/rounds — List rounds for race
router.get('/races/:id/rounds', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM rounds WHERE race_id = $1 ORDER BY round_number',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('List rounds error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/races/:id/candidates/reorder — Reorder candidates
router.put('/races/:id/candidates/reorder', async (req, res) => {
  try {
    const { candidate_ids } = req.body;
    if (!Array.isArray(candidate_ids)) {
      return res.status(400).json({ error: 'candidate_ids array is required' });
    }

    for (let i = 0; i < candidate_ids.length; i++) {
      await db.query(
        'UPDATE candidates SET display_order = $1 WHERE id = $2 AND race_id = $3',
        [i + 1, candidate_ids[i], req.params.id]
      );
    }

    const { rows } = await db.query(
      'SELECT * FROM candidates WHERE race_id = $1 ORDER BY display_order',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Reorder candidates error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/races/:id/candidates — Add candidate
router.post('/races/:id/candidates', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const { rows: [{ max }] } = await db.query(
      'SELECT COALESCE(MAX(display_order), 0) as max FROM candidates WHERE race_id = $1',
      [req.params.id]
    );

    const { rows: [candidate] } = await db.query(
      `INSERT INTO candidates (race_id, name, display_order)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.params.id, name, max + 1]
    );
    res.status(201).json(candidate);
  } catch (err) {
    console.error('Add candidate error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/candidates/:id — Update candidate
router.put('/candidates/:id', async (req, res) => {
  try {
    const { name } = req.body;
    const { rows: [candidate] } = await db.query(
      `UPDATE candidates SET name = COALESCE($1, name) WHERE id = $2 RETURNING *`,
      [name, req.params.id]
    );
    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });
    res.json(candidate);
  } catch (err) {
    console.error('Update candidate error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/candidates/:id/withdraw — Withdraw candidate
router.put('/candidates/:id/withdraw', async (req, res) => {
  try {
    const { rows: [candidate] } = await db.query(
      `UPDATE candidates SET status = 'withdrawn', withdrawn_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!candidate) return res.status(404).json({ error: 'Candidate not found' });
    res.json(candidate);
  } catch (err) {
    console.error('Withdraw candidate error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
