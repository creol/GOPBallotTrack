const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { generateUniqueEventCode } = require('../services/eventCode');

const router = Router();

// Logo uploads land at uploads/elections/{id}/logo.{ext} so they're served by the
// existing /uploads static handler at /uploads/elections/{id}/logo.{ext}.
const logoStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = path.join(__dirname, '..', '..', '..', 'uploads', 'elections', String(req.params.id));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname || '') || '.png').toLowerCase();
    cb(null, `logo${ext}`);
  },
});
const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpe?g|svg\+xml|webp|gif)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only PNG, JPEG, SVG, WEBP, or GIF images are allowed'));
  },
});

// POST /api/admin/elections — Create election
router.post('/', async (req, res) => {
  try {
    const { name, date, description } = req.body;
    if (!name || !date) {
      return res.status(400).json({ error: 'name and date are required' });
    }
    // event_code is the short path segment in the voter URL (electronic voting).
    const eventCode = await generateUniqueEventCode();
    const { rows: [election] } = await db.query(
      `INSERT INTO elections (name, date, description, event_code)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, date, description || null, eventCode]
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
    if (!election) return res.status(404).json({ error: 'Election event not found' });

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
    const { name, date, description, public_search_enabled, public_browse_enabled, dashboard_decimals, dashboard_settings } = req.body;
    const updates = ['updated_at = NOW()'];
    const values = [];
    let idx = 1;

    if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name); }
    if (date !== undefined) { updates.push(`date = $${idx++}`); values.push(date); }
    if (description !== undefined) { updates.push(`description = $${idx++}`); values.push(description); }
    if (public_search_enabled !== undefined) { updates.push(`public_search_enabled = $${idx++}`); values.push(public_search_enabled); }
    if (public_browse_enabled !== undefined) { updates.push(`public_browse_enabled = $${idx++}`); values.push(public_browse_enabled); }
    if (dashboard_decimals !== undefined) {
      const d = parseInt(dashboard_decimals, 10);
      if (!Number.isInteger(d) || d < 0 || d > 5) {
        return res.status(400).json({ error: 'dashboard_decimals must be an integer between 0 and 5' });
      }
      updates.push(`dashboard_decimals = $${idx++}`); values.push(d);
    }
    // Merge-patch into existing JSONB so partial updates from the admin UI don't
    // overwrite unrelated fields (e.g. a color tweak shouldn't clear the layout mode).
    if (dashboard_settings !== undefined && dashboard_settings !== null && typeof dashboard_settings === 'object') {
      updates.push(`dashboard_settings = COALESCE(dashboard_settings, '{}'::jsonb) || $${idx++}::jsonb`);
      values.push(JSON.stringify(dashboard_settings));
    }

    values.push(req.params.id);
    const { rows: [election] } = await db.query(
      `UPDATE elections SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!election) return res.status(404).json({ error: 'Election event not found' });
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
    if (!election) return res.status(404).json({ error: 'Election event not found' });
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
    if (!election) return res.status(404).json({ error: 'Election event not found' });

    // Hard delete if ?hard=true, otherwise soft delete
    if (req.query.hard === 'true') {
      await db.query('DELETE FROM elections WHERE id = $1', [req.params.id]);
      res.json({ message: 'Election event permanently deleted' });
    } else {
      await db.query(
        `UPDATE elections SET status = 'deleted', updated_at = NOW() WHERE id = $1`,
        [req.params.id]
      );
      res.json({ message: 'Election event deleted' });
    }
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
    if (!election) return res.status(404).json({ error: 'Election event not found' });
    res.json(election);
  } catch (err) {
    console.error('Update TV QR error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/elections/:id/dashboard-logo — Upload a logo image. Stores it on
// disk, then patches dashboard_settings.logo_path with the public URL the React
// dashboard fetches via /uploads. Old file (if any) is removed first so the folder
// doesn't accumulate stale variants when the operator re-uploads.
router.post('/:id/dashboard-logo', logoUpload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const dir = path.dirname(req.file.path);
    // Drop any other logo.* files left over from a previous upload of a different ext.
    for (const f of fs.readdirSync(dir)) {
      if (/^logo\./i.test(f) && path.join(dir, f) !== req.file.path) {
        try { fs.unlinkSync(path.join(dir, f)); } catch {}
      }
    }
    const publicUrl = `/uploads/elections/${req.params.id}/${path.basename(req.file.path)}`;
    const { rows: [election] } = await db.query(
      `UPDATE elections
         SET dashboard_settings = COALESCE(dashboard_settings, '{}'::jsonb) || $1::jsonb,
             updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      [JSON.stringify({ logo_path: publicUrl }), req.params.id]
    );
    if (!election) return res.status(404).json({ error: 'Election event not found' });
    res.json({ logo_path: publicUrl, dashboard_settings: election.dashboard_settings });
  } catch (err) {
    console.error('Upload dashboard logo error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// DELETE /api/admin/elections/:id/dashboard-logo — Remove the logo file and clear
// the path from dashboard_settings.
router.delete('/:id/dashboard-logo', async (req, res) => {
  try {
    const dir = path.join(__dirname, '..', '..', '..', 'uploads', 'elections', String(req.params.id));
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        if (/^logo\./i.test(f)) { try { fs.unlinkSync(path.join(dir, f)); } catch {} }
      }
    }
    await db.query(
      `UPDATE elections
         SET dashboard_settings = (COALESCE(dashboard_settings, '{}'::jsonb) - 'logo_path'),
             updated_at = NOW()
       WHERE id = $1`,
      [req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete dashboard logo error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
