const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { generateSerials } = require('../services/serialGenerator');
const { requireSuperAdminPin } = require('../middleware/auth');

const router = Router();

// POST /api/admin/elections/:id/races — Create race
router.post('/elections/:id/races', async (req, res) => {
  try {
    const { name, threshold_type, threshold_value, ballot_count, max_rounds, paper_colors, race_date, race_time, location, public_search_enabled, public_browse_enabled } = req.body;
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
      `INSERT INTO races (election_id, name, threshold_type, threshold_value, display_order, ballot_count, max_rounds, race_date, race_time, location, public_search_enabled, public_browse_enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [req.params.id, name, threshold_type || 'majority', threshold_value || null, max + 1,
       ballot_count || null, max_rounds || null, defaultDate, race_time || null, location || null,
       public_search_enabled !== false, public_browse_enabled === true]
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
    const { name, threshold_type, threshold_value, race_date, race_time, location, public_search_enabled, public_browse_enabled, dashboard_visible } = req.body;
    const updates = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name); }
    if (threshold_type !== undefined) { updates.push(`threshold_type = $${idx++}`); values.push(threshold_type); }
    if (threshold_value !== undefined) { updates.push(`threshold_value = $${idx++}`); values.push(threshold_value); }
    if (race_date !== undefined) { updates.push(`race_date = $${idx++}`); values.push(race_date || null); }
    if (race_time !== undefined) { updates.push(`race_time = $${idx++}`); values.push(race_time || null); }
    if (location !== undefined) { updates.push(`location = $${idx++}`); values.push(location || null); }
    if (public_search_enabled !== undefined) { updates.push(`public_search_enabled = $${idx++}`); values.push(public_search_enabled); }
    if (public_browse_enabled !== undefined) { updates.push(`public_browse_enabled = $${idx++}`); values.push(public_browse_enabled); }
    if (dashboard_visible !== undefined) { updates.push(`dashboard_visible = $${idx++}`); values.push(!!dashboard_visible); }

    if (updates.length === 0) {
      const { rows: [race] } = await db.query('SELECT * FROM races WHERE id = $1', [req.params.id]);
      if (!race) return res.status(404).json({ error: 'Race not found' });
      return res.json(race);
    }

    values.push(req.params.id);
    const { rows: [race] } = await db.query(
      `UPDATE races SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    if (!race) return res.status(404).json({ error: 'Race not found' });

    // Any update that affects public dashboard rendering (name, visibility,
    // withdrawn/outcome, etc.) should trigger a live refresh. Emitting on all
    // updates is cheap and keeps TVs in sync without per-field bookkeeping.
    const io = req.app.get('io');
    if (io) io.emit('races:changed', { election_id: race.election_id, race_id: race.id, reason: 'updated' });

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

    // Check PDF existence on disk for rounds missing ballot_pdf_generated_at
    const { rows: [race] } = await db.query('SELECT election_id FROM races WHERE id = $1', [req.params.id]);
    if (race) {
      for (const round of rows) {
        if (!round.ballot_pdf_generated_at) {
          const pdfPath = path.join(__dirname, '..', '..', '..', 'uploads', 'elections',
            String(race.election_id), 'rounds', String(round.id), 'ballots.pdf');
          if (fs.existsSync(pdfPath)) {
            round.ballot_pdf_generated_at = fs.statSync(pdfPath).mtime;
          }
        }
      }
    }

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

// PUT /api/admin/elections/:id/races/reorder — Reorder races within an election
router.put('/elections/:id/races/reorder', async (req, res) => {
  try {
    const { race_ids } = req.body;
    if (!Array.isArray(race_ids)) {
      return res.status(400).json({ error: 'race_ids array is required' });
    }

    for (let i = 0; i < race_ids.length; i++) {
      await db.query(
        'UPDATE races SET display_order = $1 WHERE id = $2 AND election_id = $3',
        [i + 1, race_ids[i], req.params.id]
      );
    }

    const { rows } = await db.query(
      'SELECT * FROM races WHERE election_id = $1 ORDER BY display_order',
      [req.params.id]
    );

    // Notify live dashboards so they re-render in the new order without a manual refresh.
    const io = req.app.get('io');
    if (io) io.emit('races:changed', { election_id: parseInt(req.params.id), reason: 'reorder' });

    res.json(rows);
  } catch (err) {
    console.error('Reorder races error:', err);
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

// PUT /api/admin/races/:id/outcome — Set race outcome.
// Terminal outcomes (winner, advances_primary, closed) flip the race to
// results_finalized — destructive, so we re-verify the operator's PIN here
// rather than trusting the client-side modal alone.
router.put('/races/:id/outcome', requireSuperAdminPin, async (req, res) => {
  try {
    const { outcome, candidate_id, notes } = req.body;
    if (!outcome || !['winner', 'advances_next_round', 'advances_primary', 'closed'].includes(outcome)) {
      return res.status(400).json({ error: 'outcome must be winner, advances_next_round, advances_primary, or closed' });
    }

    // Only finalize race for terminal outcomes — not for advances_next_round
    const isTerminal = ['winner', 'advances_primary', 'closed'].includes(outcome);
    const newStatus = isTerminal ? 'results_finalized' : 'in_progress';

    // Refuse to finalize a race while any round is still actively voting or
    // tallying — auto-canceling those would erase live work (passes, scans,
    // judge confirmations). The operator must finalize or void the active
    // round first.
    if (isTerminal) {
      const { rows: blockingRounds } = await db.query(
        "SELECT id, round_number, status FROM rounds WHERE race_id = $1 AND status IN ('voting_open', 'tallying') ORDER BY round_number",
        [req.params.id]
      );
      if (blockingRounds.length > 0) {
        const list = blockingRounds.map(r => `Round ${r.round_number} (${r.status})`).join(', ');
        return res.status(400).json({
          error: `Cannot finalize race — these rounds are still active: ${list}. Finalize or void them first.`,
        });
      }
    }

    const { rows: [race] } = await db.query(
      `UPDATE races SET
        outcome = $1, outcome_candidate_id = $2, outcome_notes = $3,
        outcome_at = NOW(), status = $4
       WHERE id = $5 RETURNING *`,
      [outcome, candidate_id || null, notes || null, newStatus, req.params.id]
    );
    if (!race) return res.status(404).json({ error: 'Race not found' });

    // For terminal outcomes, only cancel rounds that have no committed work yet.
    // tallying / voting_open are protected by the guard above; round_finalized
    // and canceled are left alone; voting_closed is preserved too because it
    // means voting completed and the operator may still want to tally it.
    if (isTerminal) {
      await db.query(
        "UPDATE rounds SET status = 'canceled' WHERE race_id = $1 AND status IN ('pending_needs_action', 'ready')",
        [req.params.id]
      );
    }

    res.json(race);
  } catch (err) {
    console.error('Set race outcome error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/races/:id/final-designations — Persist per-candidate official
// designations (Official Nominee / Progress to Primary). Mutually exclusive per
// candidate. Used when generating the official Race Summary PDF.
// Body: { designations: [{ candidate_id, designation: 'official_nominee'|'progress_to_primary'|null }] }
router.put('/races/:id/final-designations', async (req, res) => {
  try {
    const { designations } = req.body;
    if (!Array.isArray(designations)) {
      return res.status(400).json({ error: 'designations array is required' });
    }
    for (const d of designations) {
      if (d.designation !== null && !['official_nominee', 'progress_to_primary'].includes(d.designation)) {
        return res.status(400).json({ error: `Invalid designation: ${d.designation}` });
      }
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      for (const d of designations) {
        await client.query(
          'UPDATE candidates SET final_designation = $1 WHERE id = $2 AND race_id = $3',
          [d.designation, d.candidate_id, req.params.id]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const { rows } = await db.query(
      'SELECT * FROM candidates WHERE race_id = $1 ORDER BY display_order',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('Set final designations error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/races/:id/summary-pdf — Download official Race Summary PDF
router.get('/races/:id/summary-pdf', async (req, res) => {
  try {
    const { generateRaceSummaryPdf } = require('../pdf/raceSummaryPdf');
    const { pdfPath, downloadName } = await generateRaceSummaryPdf(req.params.id);
    res.download(pdfPath, downloadName);
  } catch (err) {
    console.error('Race summary PDF error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
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
