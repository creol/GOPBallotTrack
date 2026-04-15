const { Router } = require('express');
const db = require('../db');

const router = Router();

/**
 * Helper: record a status transition and update entity status.
 */
async function transitionStatus(entityType, entityId, newStatus, changedBy) {
  // Close previous transition
  await db.query(
    `UPDATE status_transitions SET ended_at = NOW(), duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER
     WHERE entity_type = $1 AND entity_id = $2 AND ended_at IS NULL`,
    [entityType, entityId]
  );

  // Insert new transition
  const { rows: [entity] } = await db.query(
    `SELECT status FROM ${entityType === 'race' ? 'races' : 'rounds'} WHERE id = $1`,
    [entityId]
  );

  await db.query(
    `INSERT INTO status_transitions (entity_type, entity_id, from_status, to_status, changed_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [entityType, entityId, entity?.status || null, newStatus, changedBy || null]
  );

  // Update the entity
  if (entityType === 'race') {
    await db.query('UPDATE races SET status = $1 WHERE id = $2', [newStatus, entityId]);
  } else {
    await db.query('UPDATE rounds SET status = $1 WHERE id = $2', [newStatus, entityId]);
  }
}

// GET /api/admin/control-center — Get all races/rounds with current status
router.get('/', async (req, res) => {
  try {
    const { rows: elections } = await db.query(
      "SELECT * FROM elections WHERE status != 'deleted' ORDER BY created_at DESC"
    );

    const result = [];
    for (const election of elections) {
      const { rows: races } = await db.query(
        'SELECT * FROM races WHERE election_id = $1 ORDER BY display_order',
        [election.id]
      );

      for (const race of races) {
        const { rows: rounds } = await db.query(
          "SELECT * FROM rounds WHERE race_id = $1 AND status != 'canceled' ORDER BY round_number",
          [race.id]
        );

        // Get latest round
        const currentRound = rounds[rounds.length - 1] || null;

        // Get results for finalized rounds
        for (const round of rounds) {
          if (round.status === 'round_finalized' || round.published_at) {
            const { rows: results } = await db.query(
              `SELECT rr.*, c.name as candidate_name
               FROM round_results rr
               JOIN candidates c ON c.id = rr.candidate_id
               WHERE rr.round_id = $1
               ORDER BY rr.vote_count DESC`,
              [round.id]
            );
            round.results = results;
          }
        }

        result.push({
          election_id: election.id,
          election_name: election.name,
          race_id: race.id,
          race_name: race.name,
          race_status: race.status,
          rounds,
          current_round: currentRound,
        });
      }
    }

    res.json(result);
  } catch (err) {
    console.error('Control center data error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/control-center/round/:id/open-voting — Move round to voting_open
router.post('/round/:id/open-voting', async (req, res) => {
  try {
    const roundId = parseInt(req.params.id);
    const { rows: [round] } = await db.query('SELECT * FROM rounds WHERE id = $1', [roundId]);
    if (!round) return res.status(404).json({ error: 'Round not found' });
    if (round.status !== 'ready') {
      return res.status(400).json({ error: `Round must be in 'ready' status (current: ${round.status})` });
    }

    // Gate: previous round must be finalized+published or canceled before opening this one
    if (round.round_number > 1) {
      const { rows: [prevRound] } = await db.query(
        'SELECT * FROM rounds WHERE race_id = $1 AND round_number = $2 ORDER BY round_number DESC LIMIT 1',
        [round.race_id, round.round_number - 1]
      );
      if (prevRound && prevRound.status !== 'canceled' &&
          !(prevRound.status === 'round_finalized' && prevRound.published_at)) {
        return res.status(400).json({
          error: `Previous round (Round ${prevRound.round_number}) must be finalized and published, or voided, before opening this round for voting. Current status: ${prevRound.status}${prevRound.published_at ? ', published' : ', not published'}`
        });
      }
    }

    await transitionStatus('round', roundId, 'voting_open', req.session?.name);

    // Auto-set race to in_progress
    const { rows: [race] } = await db.query('SELECT * FROM races WHERE id = $1', [round.race_id]);
    if (race && race.status !== 'in_progress') {
      await transitionStatus('race', race.id, 'in_progress', req.session?.name);
    }

    const io = req.app.get('io');
    if (io) io.emit('status:changed', { type: 'round', id: roundId, status: 'voting_open', race_id: round.race_id });

    res.json({ message: 'Voting opened', round_id: roundId });
  } catch (err) {
    console.error('Open voting error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/control-center/round/:id/close-voting — Move round to voting_closed
router.post('/round/:id/close-voting', async (req, res) => {
  try {
    const roundId = parseInt(req.params.id);
    const { rows: [round] } = await db.query('SELECT * FROM rounds WHERE id = $1', [roundId]);
    if (!round) return res.status(404).json({ error: 'Round not found' });
    if (round.status !== 'voting_open') {
      return res.status(400).json({ error: `Round must be in 'voting_open' status (current: ${round.status})` });
    }

    await transitionStatus('round', roundId, 'voting_closed', req.session?.name);

    const io = req.app.get('io');
    if (io) io.emit('status:changed', { type: 'round', id: roundId, status: 'voting_closed', race_id: round.race_id });

    res.json({ message: 'Voting closed', round_id: roundId });
  } catch (err) {
    console.error('Close voting error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/control-center/round/:id/open-tallying — Move round to tallying
router.post('/round/:id/open-tallying', async (req, res) => {
  try {
    const roundId = parseInt(req.params.id);
    const { rows: [round] } = await db.query('SELECT * FROM rounds WHERE id = $1', [roundId]);
    if (!round) return res.status(404).json({ error: 'Round not found' });
    if (round.status !== 'voting_closed') {
      return res.status(400).json({ error: `Round must be in 'voting_closed' status (current: ${round.status})` });
    }

    await transitionStatus('round', roundId, 'tallying', req.session?.name);

    const io = req.app.get('io');
    if (io) io.emit('status:changed', { type: 'round', id: roundId, status: 'tallying', race_id: round.race_id });

    res.json({ message: 'Tallying opened — scanner page is now active', round_id: roundId });
  } catch (err) {
    console.error('Open tallying error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/control-center/round/:id/publish — Publish results to dashboard
router.post('/round/:id/publish', async (req, res) => {
  try {
    const roundId = parseInt(req.params.id);
    const { rows: [round] } = await db.query('SELECT * FROM rounds WHERE id = $1', [roundId]);
    if (!round) return res.status(404).json({ error: 'Round not found' });
    if (round.status !== 'round_finalized') {
      return res.status(400).json({ error: `Round must be finalized before publishing (current: ${round.status})` });
    }
    if (round.published_at) {
      return res.status(400).json({ error: 'Round is already published' });
    }

    await db.query('UPDATE rounds SET published_at = NOW() WHERE id = $1', [roundId]);

    const io = req.app.get('io');
    if (io) io.emit('round:released', { round_id: roundId });
    if (io) io.emit('status:changed', { type: 'round', id: roundId, status: 'published', race_id: round.race_id });

    res.json({ message: 'Results published to dashboard', round_id: roundId });
  } catch (err) {
    console.error('Publish error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/control-center/round/:id/recount — Issue recount
router.post('/round/:id/recount', async (req, res) => {
  try {
    const roundId = parseInt(req.params.id);
    const { notes } = req.body;
    if (!notes) return res.status(400).json({ error: 'Notes are required for a recount' });

    const { rows: [round] } = await db.query('SELECT * FROM rounds WHERE id = $1', [roundId]);
    if (!round) return res.status(404).json({ error: 'Round not found' });
    if (round.status !== 'round_finalized') {
      return res.status(400).json({ error: 'Round must be finalized to issue a recount' });
    }

    // Archive old results (don't delete — add a note)
    await db.query(
      "UPDATE round_results SET outcome = 'archived_recount' WHERE round_id = $1",
      [roundId]
    );

    // Delete existing passes (soft delete)
    await db.query(
      "UPDATE passes SET status = 'deleted', deleted_reason = $1 WHERE round_id = $2 AND status != 'deleted'",
      [`Recount issued: ${notes}`, roundId]
    );

    // Reset published_at
    await db.query('UPDATE rounds SET published_at = NULL WHERE id = $1', [roundId]);

    await transitionStatus('round', roundId, 'tallying', req.session?.name);

    const io = req.app.get('io');
    if (io) io.emit('status:changed', { type: 'round', id: roundId, status: 'tallying', race_id: round.race_id });

    res.json({ message: 'Recount issued — round reset to tallying', round_id: roundId });
  } catch (err) {
    console.error('Recount error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/control-center/round/:id/void — Void round and advance
router.post('/round/:id/void', async (req, res) => {
  try {
    const roundId = parseInt(req.params.id);
    const { notes } = req.body;
    if (!notes) return res.status(400).json({ error: 'Notes are required to void a round' });

    const { rows: [round] } = await db.query('SELECT * FROM rounds WHERE id = $1', [roundId]);
    if (!round) return res.status(404).json({ error: 'Round not found' });

    await db.query('UPDATE rounds SET published_at = NULL WHERE id = $1', [roundId]);
    await transitionStatus('round', roundId, 'canceled', req.session?.name);

    // Add void notes to round
    await db.query(
      'UPDATE rounds SET confirmed_by = $1, confirmed_at = NOW() WHERE id = $2',
      [`VOIDED: ${notes}`, roundId]
    );

    const io = req.app.get('io');
    if (io) io.emit('status:changed', { type: 'round', id: roundId, status: 'canceled', race_id: round.race_id });

    res.json({ message: 'Round voided', round_id: roundId });
  } catch (err) {
    console.error('Void round error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/control-center/race/:id/finalize — Finalize race (no more rounds)
router.post('/race/:id/finalize', async (req, res) => {
  try {
    const raceId = parseInt(req.params.id);

    // Cancel any pending/ready rounds
    await db.query(
      "UPDATE rounds SET status = 'canceled' WHERE race_id = $1 AND status IN ('pending_needs_action', 'ready')",
      [raceId]
    );

    await transitionStatus('race', raceId, 'results_finalized', req.session?.name);

    const io = req.app.get('io');
    if (io) io.emit('status:changed', { type: 'race', id: raceId, status: 'results_finalized' });

    res.json({ message: 'Race finalized', race_id: raceId });
  } catch (err) {
    console.error('Finalize race error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/control-center/round/:id/reverse-finalize — Reverse a finalized round (Super Admin)
// Unpublishes and sets round back to tallying so passes can be modified.
router.post('/round/:id/reverse-finalize', async (req, res) => {
  try {
    const roundId = parseInt(req.params.id);
    const { notes } = req.body;
    if (!notes || !notes.trim()) {
      return res.status(400).json({ error: 'Notes are required to reverse finalization' });
    }

    const { rows: [round] } = await db.query('SELECT * FROM rounds WHERE id = $1', [roundId]);
    if (!round) return res.status(404).json({ error: 'Round not found' });
    if (round.status !== 'round_finalized') {
      return res.status(400).json({ error: `Round must be finalized to reverse (current: ${round.status})` });
    }

    // Check race is not finalized
    const { rows: [race] } = await db.query('SELECT * FROM races WHERE id = $1', [round.race_id]);
    if (race.status === 'results_finalized') {
      return res.status(400).json({ error: 'Cannot reverse round — race is finalized. Reverse race finalization first.' });
    }

    // Unpublish and reset to tallying
    await db.query(
      'UPDATE rounds SET published_at = NULL, released_by = NULL, released_at = NULL WHERE id = $1',
      [roundId]
    );

    await transitionStatus('round', roundId, 'tallying', req.session?.name);

    // Record audit entry
    await db.query(
      `INSERT INTO status_transitions (entity_type, entity_id, from_status, to_status, changed_by)
       VALUES ('round_reverse_finalize', $1, 'round_finalized', 'tallying', $2)`,
      [roundId, `${req.session?.name}: ${notes}`]
    );

    const io = req.app.get('io');
    if (io) io.emit('status:changed', { type: 'round', id: roundId, status: 'tallying', race_id: round.race_id });

    res.json({ message: 'Round finalization reversed — round is back in tallying', round_id: roundId });
  } catch (err) {
    console.error('Reverse finalize round error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/control-center/race/:id/reverse-finalize — Reverse a finalized race (Super Admin)
// Sets race back to in_progress so rounds can be modified.
router.post('/race/:id/reverse-finalize', async (req, res) => {
  try {
    const raceId = parseInt(req.params.id);
    const { notes } = req.body;
    if (!notes || !notes.trim()) {
      return res.status(400).json({ error: 'Notes are required to reverse race finalization' });
    }

    const { rows: [race] } = await db.query('SELECT * FROM races WHERE id = $1', [raceId]);
    if (!race) return res.status(404).json({ error: 'Race not found' });
    if (race.status !== 'results_finalized') {
      return res.status(400).json({ error: `Race must be finalized to reverse (current: ${race.status})` });
    }

    await transitionStatus('race', raceId, 'in_progress', req.session?.name);

    // Record audit entry
    await db.query(
      `INSERT INTO status_transitions (entity_type, entity_id, from_status, to_status, changed_by)
       VALUES ('race_reverse_finalize', $1, 'results_finalized', 'in_progress', $2)`,
      [raceId, `${req.session?.name}: ${notes}`]
    );

    const io = req.app.get('io');
    if (io) io.emit('status:changed', { type: 'race', id: raceId, status: 'in_progress' });

    res.json({ message: 'Race finalization reversed — race is back in progress', race_id: raceId });
  } catch (err) {
    console.error('Reverse finalize race error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/control-center/transitions/:entityType/:entityId — Get status transition history
router.get('/transitions/:entityType/:entityId', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM status_transitions
       WHERE entity_type = $1 AND entity_id = $2
       ORDER BY started_at`,
      [req.params.entityType, parseInt(req.params.entityId)]
    );
    res.json(rows);
  } catch (err) {
    console.error('Transitions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
