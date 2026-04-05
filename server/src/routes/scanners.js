const { Router } = require('express');
const db = require('../db');
const { restartWatchers } = require('../middleware/scanWatcher');

const router = Router();

// POST /api/admin/elections/:electionId/scanners — Register scanner
// Only requires a name — path is auto-generated as /app/data/scans/{slug}/incoming
router.post('/elections/:electionId/scanners', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    // Auto-generate container path from scanner name
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const watchPath = `/app/data/scans/${slug}/incoming`;

    const { rows: [scanner] } = await db.query(
      `INSERT INTO scanners (election_id, name, watch_folder_path)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.params.electionId, name, watchPath]
    );

    // Start watching the new scanner's folder immediately
    const io = req.app.get('io');
    if (io) restartWatchers(io);

    res.status(201).json(scanner);
  } catch (err) {
    console.error('Create scanner error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/scanners-global — List all global scanners
router.get('/scanners-global', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM scanners ORDER BY name');
    res.json(rows);
  } catch (err) {
    console.error('List global scanners error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/elections/:electionId/scanners — List all scanners (returns global scanners)
router.get('/elections/:electionId/scanners', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM scanners ORDER BY name');
    res.json(rows);
  } catch (err) {
    console.error('List scanners error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/scanners/:id — Update scanner
router.put('/scanners/:id', async (req, res) => {
  try {
    const { name, watch_folder_path, status } = req.body;
    const { rows: [scanner] } = await db.query(
      `UPDATE scanners SET
        name = COALESCE($1, name),
        watch_folder_path = COALESCE($2, watch_folder_path),
        status = COALESCE($3, status)
       WHERE id = $4 RETURNING *`,
      [name, watch_folder_path, status, req.params.id]
    );
    if (!scanner) return res.status(404).json({ error: 'Scanner not found' });
    res.json(scanner);
  } catch (err) {
    console.error('Update scanner error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/scanners/:id — Delete scanner
router.delete('/scanners/:id', async (req, res) => {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM scanners WHERE id = $1', [req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Scanner not found' });

    // Stop watching the deleted scanner's folder
    const io = req.app.get('io');
    if (io) restartWatchers(io);

    res.json({ message: 'Scanner deleted' });
  } catch (err) {
    console.error('Delete scanner error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/scanners/:id/assign-box — Assign scanner to a ballot box
router.put('/scanners/:id/assign-box', async (req, res) => {
  try {
    const { box_id } = req.body;
    const { rows: [scanner] } = await db.query(
      `UPDATE scanners SET current_box_id = $1 WHERE id = $2 RETURNING *`,
      [box_id || null, req.params.id]
    );
    if (!scanner) return res.status(404).json({ error: 'Scanner not found' });
    res.json(scanner);
  } catch (err) {
    console.error('Assign box error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
