const { Router } = require('express');
const db = require('../db');
const { hashPin } = require('../middleware/auth');

const router = Router();

// GET /api/admin/users — List all admin users
router.get('/users', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, name, role, must_change_pin, created_at FROM admin_users ORDER BY created_at'
    );

    // Attach race assignments for race_admins
    for (const user of rows) {
      if (user.role === 'race_admin') {
        const { rows: assignments } = await db.query(
          `SELECT ra.race_id, r.name as race_name
           FROM race_admin_assignments ra
           JOIN races r ON r.id = ra.race_id
           WHERE ra.admin_user_id = $1`,
          [user.id]
        );
        user.assigned_races = assignments;
      } else {
        user.assigned_races = [];
      }
    }

    res.json(rows);
  } catch (err) {
    console.error('List admin users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/users — Create a new admin user
router.post('/users', async (req, res) => {
  try {
    const { name, role, pin } = req.body;
    if (!name || !role) return res.status(400).json({ error: 'name and role are required' });
    if (!['super_admin', 'race_admin'].includes(role)) {
      return res.status(400).json({ error: 'role must be super_admin or race_admin' });
    }

    const pinToHash = pin || '0000';
    const { rows: [user] } = await db.query(
      `INSERT INTO admin_users (name, role, pin_hash, must_change_pin)
       VALUES ($1, $2, $3, true) RETURNING id, name, role, must_change_pin, created_at`,
      [name, role, hashPin(pinToHash)]
    );
    res.status(201).json(user);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A user with that name already exists' });
    }
    console.error('Create admin user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/users/:id — Update user (name, role)
router.put('/users/:id', async (req, res) => {
  try {
    const { name, role } = req.body;
    const { rows: [user] } = await db.query(
      `UPDATE admin_users SET
        name = COALESCE($1, name),
        role = COALESCE($2, role)
       WHERE id = $3 RETURNING id, name, role, must_change_pin, created_at`,
      [name || null, role || null, req.params.id]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    console.error('Update admin user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/users/:id — Delete user
router.delete('/users/:id', async (req, res) => {
  try {
    const { rowCount } = await db.query('DELETE FROM admin_users WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'User deleted' });
  } catch (err) {
    console.error('Delete admin user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/users/:id/reset-pin — Reset user's PIN to default (0000)
router.post('/users/:id/reset-pin', async (req, res) => {
  try {
    const newPin = req.body.pin || '0000';
    const { rows: [user] } = await db.query(
      `UPDATE admin_users SET pin_hash = $1, must_change_pin = true
       WHERE id = $2 RETURNING id, name, role`,
      [hashPin(newPin), req.params.id]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ message: `PIN reset for ${user.name}`, user });
  } catch (err) {
    console.error('Reset PIN error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/users/:id/assign-race — Assign race_admin to a race
router.post('/users/:id/assign-race', async (req, res) => {
  try {
    const { race_id } = req.body;
    if (!race_id) return res.status(400).json({ error: 'race_id is required' });

    const { rows: [assignment] } = await db.query(
      `INSERT INTO race_admin_assignments (admin_user_id, race_id)
       VALUES ($1, $2) RETURNING *`,
      [req.params.id, race_id]
    );
    res.status(201).json(assignment);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'User is already assigned to this race' });
    }
    console.error('Assign race error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/users/:id/unassign-race/:raceId — Remove race assignment
router.delete('/users/:id/unassign-race/:raceId', async (req, res) => {
  try {
    const { rowCount } = await db.query(
      'DELETE FROM race_admin_assignments WHERE admin_user_id = $1 AND race_id = $2',
      [req.params.id, req.params.raceId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Assignment not found' });
    res.json({ message: 'Race assignment removed' });
  } catch (err) {
    console.error('Unassign race error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
