const { Router } = require('express');
const db = require('../db');
const { generateSerials } = require('../services/serialGenerator');

const router = Router();

// POST /api/admin/elections/:id/races — Create race
router.post('/elections/:id/races', async (req, res) => {
  try {
    const { name, threshold_type, threshold_value, ballot_count, max_rounds, paper_colors, race_date, race_time, location } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    // Get next display_order
    const { rows: [{ max }] } = await db.query(
      'SELECT COALESCE(MAX(display_order), 0) as max FROM races WHERE election_id = $1',
      [req.params.id]
    );

    // Default race_date to election date if not provided
    let defaultDate = race_date || null;
    if (!defaultDate) {
      const { rows: [election] } = await db.query('SELECT date FROM elections WHERE id = $1', [req.params.id]);
      if (election?.date) defaultDate = election.date;
    }

    const { rows: [race] } = await db.query(
      `INSERT INTO races (election_id, name, threshold_type, threshold_value, display_order, ballot_count, max_rounds, race_date, race_time, location)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [req.params.id, name, threshold_type || 'majority', threshold_value || null, max + 1,
       ballot_count || null, max_rounds || null, defaultDate, race_time || null, location || null]
    );

    // If ballot_count and max_rounds provided, auto-create rounds with SNs
    if (ballot_count && max_rounds && max_rounds > 0) {
      const colors = paper_colors || [];
      for (let i = 1; i <= max_rounds; i++) {
        const color = colors[i - 1] || `Round ${i}`;
        const { rows: [round] } = await db.query(
          `INSERT INTO rounds (race_id, round_number, paper_color) VALUES ($1, $2, $3) RETURNING id`,
          [race.id, i, color]
        );
        await generateSerials(round.id, ballot_count);
      }
    }

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
    const { name, threshold_type, threshold_value, race_date, race_time, location } = req.body;
    const { rows: [race] } = await db.query(
      `UPDATE races SET
        name = COALESCE($1, name),
        threshold_type = COALESCE($2, threshold_type),
        threshold_value = COALESCE($3, threshold_value),
        race_date = COALESCE($4, race_date),
        race_time = COALESCE($5, race_time),
        location = COALESCE($6, location)
       WHERE id = $7 RETURNING *`,
      [name, threshold_type, threshold_value, race_date || null, race_time || null, location || null, req.params.id]
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

// PUT /api/admin/races/:id/outcome — Set race outcome
router.put('/races/:id/outcome', async (req, res) => {
  try {
    const { outcome, candidate_id, notes } = req.body;
    if (!outcome || !['winner', 'advances_next_round', 'advances_primary', 'closed'].includes(outcome)) {
      return res.status(400).json({ error: 'outcome must be winner, advances_next_round, advances_primary, or closed' });
    }

    const { rows: [race] } = await db.query(
      `UPDATE races SET
        outcome = $1, outcome_candidate_id = $2, outcome_notes = $3,
        outcome_at = NOW(), status = 'results_finalized'
       WHERE id = $4 RETURNING *`,
      [outcome, candidate_id || null, notes || null, req.params.id]
    );
    if (!race) return res.status(404).json({ error: 'Race not found' });

    // Close any pending rounds for this race
    if (outcome === 'closed') {
      await db.query(
        "UPDATE rounds SET status = 'canceled' WHERE race_id = $1 AND status IN ('pending_needs_action', 'ready', 'tallying')",
        [req.params.id]
      );
    }

    res.json(race);
  } catch (err) {
    console.error('Set race outcome error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/admin/races/:id/outcome — Clear race outcome (reopen)
router.delete('/races/:id/outcome', async (req, res) => {
  try {
    const { rows: [race] } = await db.query(
      `UPDATE races SET outcome = NULL, outcome_candidate_id = NULL, outcome_notes = NULL,
        outcome_at = NULL, status = 'in_progress'
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!race) return res.status(404).json({ error: 'Race not found' });
    res.json(race);
  } catch (err) {
    console.error('Clear race outcome error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
