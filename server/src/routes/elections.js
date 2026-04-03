const { Router } = require('express');
const db = require('../db');

const router = Router();

// POST /api/admin/elections — Create election
router.post('/', async (req, res) => {
  try {
    const { name, date, description } = req.body;
    if (!name || !date) {
      return res.status(400).json({ error: 'name and date are required' });
    }
    const { rows: [election] } = await db.query(
      `INSERT INTO elections (name, date, description)
       VALUES ($1, $2, $3) RETURNING *`,
      [name, date, description || null]
    );
    res.status(201).json(election);
  } catch (err) {
    console.error('Create election error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/elections — List all elections (filter out deleted)
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM elections WHERE status != 'deleted' ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('List elections error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/elections/:id — Get election with races
router.get('/:id', async (req, res) => {
  try {
    const { rows: [election] } = await db.query(
      'SELECT * FROM elections WHERE id = $1', [req.params.id]
    );
    if (!election) return res.status(404).json({ error: 'Election not found' });

    const { rows: races } = await db.query(
      'SELECT * FROM races WHERE election_id = $1 ORDER BY display_order', [election.id]
    );
    res.json({ ...election, races });
  } catch (err) {
    console.error('Get election error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/elections/:id — Update election
router.put('/:id', async (req, res) => {
  try {
    const { name, date, description } = req.body;
    const { rows: [election] } = await db.query(
      `UPDATE elections SET
        name = COALESCE($1, name),
        date = COALESCE($2, date),
        description = COALESCE($3, description),
        updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [name, date, description, req.params.id]
    );
    if (!election) return res.status(404).json({ error: 'Election not found' });
    res.json(election);
  } catch (err) {
    console.error('Update election error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/elections/:id/archive — Archive election
router.put('/:id/archive', async (req, res) => {
  try {
    const { rows: [election] } = await db.query(
      `UPDATE elections SET status = 'archived', updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!election) return res.status(404).json({ error: 'Election not found' });
    res.json(election);
  } catch (err) {
    console.error('Archive election error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/elections/:id — Delete election
router.delete('/:id', async (req, res) => {
  try {
    const { rows: [election] } = await db.query(
      'SELECT * FROM elections WHERE id = $1', [req.params.id]
    );
    if (!election) return res.status(404).json({ error: 'Election not found' });

    // Soft delete
    await db.query(
      `UPDATE elections SET status = 'deleted', updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    );
    res.json({ message: 'Election deleted' });
  } catch (err) {
    console.error('Delete election error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/elections/:id/tv-qr — Enable/disable QR code on TV display
router.put('/:id/tv-qr', async (req, res) => {
  try {
    const { enabled, url } = req.body;
    const { rows: [election] } = await db.query(
      `UPDATE elections SET tv_qr_enabled = $1, tv_qr_url = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [!!enabled, url || null, req.params.id]
    );
    if (!election) return res.status(404).json({ error: 'Election not found' });
    res.json(election);
  } catch (err) {
    console.error('Update TV QR error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
