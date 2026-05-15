const { Router } = require('express');
const db = require('../db');

const router = Router();

// GET /api/admin/dashboard-templates — list all global templates
router.get('/', async (_req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name, settings, created_at, updated_at FROM dashboard_templates ORDER BY name'
    );
    res.json(rows);
  } catch (err) {
    console.error('List dashboard templates error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/dashboard-templates — create a new template
router.post('/', async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const settings = req.body?.settings;
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!settings || typeof settings !== 'object') return res.status(400).json({ error: 'settings must be an object' });

    const { rows: [existing] } = await db.query('SELECT id FROM dashboard_templates WHERE name = $1', [name]);
    if (existing) return res.status(409).json({ error: `A template named "${name}" already exists` });

    const { rows: [tpl] } = await db.query(
      'INSERT INTO dashboard_templates (name, settings) VALUES ($1, $2::jsonb) RETURNING *',
      [name, JSON.stringify(settings)]
    );
    res.status(201).json(tpl);
  } catch (err) {
    console.error('Create dashboard template error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/dashboard-templates/:id — rename or update settings
router.put('/:id', async (req, res) => {
  try {
    const updates = ['updated_at = NOW()'];
    const values = [];
    let idx = 1;
    if (typeof req.body?.name === 'string') {
      const name = req.body.name.trim();
      if (!name) return res.status(400).json({ error: 'name cannot be empty' });
      updates.push(`name = $${idx++}`); values.push(name);
    }
    if (req.body?.settings && typeof req.body.settings === 'object') {
      updates.push(`settings = $${idx++}::jsonb`); values.push(JSON.stringify(req.body.settings));
    }
    values.push(req.params.id);
    const { rows: [tpl] } = await db.query(
      `UPDATE dashboard_templates SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!tpl) return res.status(404).json({ error: 'Template not found' });
    res.json(tpl);
  } catch (err) {
    if (err && err.code === '23505') return res.status(409).json({ error: 'A template with that name already exists' });
    console.error('Update dashboard template error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/dashboard-templates/:id
router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM dashboard_templates WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete dashboard template error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
