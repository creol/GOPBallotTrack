const { Router } = require('express');
const db = require('../db');

const router = Router();

// POST /api/admin/elections/:id/ballot-boxes — Create ballot box
router.post('/elections/:id/ballot-boxes', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const { rows: [box] } = await db.query(
      `INSERT INTO ballot_boxes (election_id, name) VALUES ($1, $2) RETURNING *`,
      [req.params.id, name]
    );
    res.status(201).json(box);
  } catch (err) {
    console.error('Create ballot box error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/elections/:id/ballot-boxes — List ballot boxes
router.get('/elections/:id/ballot-boxes', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM ballot_boxes WHERE election_id = $1 ORDER BY created_at',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('List ballot boxes error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/ballot-boxes/:id — Delete ballot box
router.delete('/ballot-boxes/:id', async (req, res) => {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM ballot_boxes WHERE id = $1', [req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Ballot box not found' });
    res.json({ message: 'Ballot box deleted' });
  } catch (err) {
    console.error('Delete ballot box error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
