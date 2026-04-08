const { Router } = require('express');
const db = require('../db');
const { generateSerials } = require('../services/serialGenerator');

const router = Router();

// POST /api/admin/races/:id/rounds — Create round (paper_color required)
// Auto-generates SNs using the race's ballot_count
router.post('/races/:id/rounds', async (req, res) => {
  try {
    const { paper_color } = req.body;
    if (!paper_color) return res.status(400).json({ error: 'paper_color is required' });

    const raceId = parseInt(req.params.id);

    // Get race to check ballot_count
    const { rows: [race] } = await db.query('SELECT * FROM races WHERE id = $1', [raceId]);
    if (!race) return res.status(404).json({ error: 'Race not found' });

    // Get next round_number
    const { rows: [{ max }] } = await db.query(
      'SELECT COALESCE(MAX(round_number), 0) as max FROM rounds WHERE race_id = $1',
      [raceId]
    );

    const { rows: [round] } = await db.query(
      `INSERT INTO rounds (race_id, round_number, paper_color)
       VALUES ($1, $2, $3) RETURNING *`,
      [raceId, max + 1, paper_color]
    );

    // Auto-generate SNs if the race has a ballot_count set
    let serialCount = 0;
    if (race.ballot_count && race.ballot_count > 0) {
      const serials = await generateSerials(round.id, race.ballot_count);
      serialCount = serials.length;
    }

    res.status(201).json({ ...round, serial_count: serialCount });
  } catch (err) {
    console.error('Create round error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/rounds/:id — Update round (paper_color)
router.put('/rounds/:id', async (req, res) => {
  try {
    const { paper_color } = req.body;
    if (!paper_color || !paper_color.trim()) return res.status(400).json({ error: 'paper_color is required' });

    const { rows: [round] } = await db.query(
      'UPDATE rounds SET paper_color = $1 WHERE id = $2 RETURNING *',
      [paper_color.trim(), req.params.id]
    );
    if (!round) return res.status(404).json({ error: 'Round not found' });

    res.json(round);
  } catch (err) {
    console.error('Update round error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/rounds/:id — Get round detail with passes and results
router.get('/rounds/:id', async (req, res) => {
  try {
    const { rows: [round] } = await db.query(
      'SELECT * FROM rounds WHERE id = $1', [req.params.id]
    );
    if (!round) return res.status(404).json({ error: 'Round not found' });

    const { rows: passes } = await db.query(
      'SELECT * FROM passes WHERE round_id = $1 ORDER BY pass_number',
      [round.id]
    );

    const { rows: results } = await db.query(
      `SELECT rr.*, c.name as candidate_name
       FROM round_results rr
       JOIN candidates c ON c.id = rr.candidate_id
       WHERE rr.round_id = $1
       ORDER BY rr.vote_count DESC`,
      [round.id]
    );

    // Get race and election info for context
    const { rows: [race] } = await db.query(
      'SELECT * FROM races WHERE id = $1', [round.race_id]
    );
    const { rows: [election] } = await db.query(
      'SELECT id, name FROM elections WHERE id = $1', [race.election_id]
    );

    // Get ballot serial count
    const { rows: [{ count: serialCount }] } = await db.query(
      'SELECT COUNT(*) as count FROM ballot_serials WHERE round_id = $1', [round.id]
    );

    res.json({ ...round, passes, results, race: { ...race, election }, serial_count: parseInt(serialCount) });
  } catch (err) {
    console.error('Get round error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/rounds/:id/box-counts — Ballot box breakdown for a round
router.get('/rounds/:id/box-counts', async (req, res) => {
  try {
    const roundId = parseInt(req.params.id);

    // Get all ballot boxes for this election
    const { rows: [round] } = await db.query('SELECT * FROM rounds WHERE id = $1', [roundId]);
    if (!round) return res.status(404).json({ error: 'Round not found' });
    const { rows: [race] } = await db.query('SELECT * FROM races WHERE id = $1', [round.race_id]);

    const { rows: boxes } = await db.query(
      'SELECT * FROM ballot_boxes WHERE election_id = $1 ORDER BY created_at', [race.election_id]
    );

    // Get candidates for this race
    const { rows: candidates } = await db.query(
      "SELECT * FROM candidates WHERE race_id = $1 AND status = 'active' ORDER BY display_order",
      [round.race_id]
    );

    // Get all non-deleted passes for this round
    const { rows: passes } = await db.query(
      "SELECT * FROM passes WHERE round_id = $1 AND status != 'deleted' ORDER BY pass_number",
      [roundId]
    );

    // Get scans grouped by pass, box, and candidate
    const { rows: scanCounts } = await db.query(
      `SELECT s.ballot_box_id, s.candidate_id, p.id as pass_id, p.pass_number, COUNT(*) as count
       FROM scans s
       JOIN passes p ON p.id = s.pass_id
       WHERE p.round_id = $1 AND p.status != 'deleted'
       GROUP BY s.ballot_box_id, s.candidate_id, p.id, p.pass_number`,
      [roundId]
    );

    // Get scanner assignments
    const { rows: scanners } = await db.query(
      "SELECT id, name, current_box_id FROM scanners WHERE election_id = $1 AND status = 'active'",
      [race.election_id]
    );

    // Build result per pass
    const boxIds = [...boxes.map(b => b.id), null]; // include null for unassigned

    const buildBoxBreakdown = (passFilter) => {
      const filtered = passFilter ? scanCounts.filter(passFilter) : scanCounts;
      return boxIds.map(boxId => {
        const box = boxes.find(b => b.id === boxId);
        const boxScans = filtered.filter(sc => sc.ballot_box_id === boxId);
        const totalScans = boxScans.reduce((sum, sc) => sum + parseInt(sc.count), 0);
        const candidateBreakdown = candidates.map(c => {
          const match = boxScans.find(sc => sc.candidate_id === c.id);
          return { candidate_id: c.id, candidate_name: c.name, count: match ? parseInt(match.count) : 0 };
        });
        const assignedScanners = scanners.filter(s => s.current_box_id === boxId);

        return {
          box_id: boxId,
          box_name: box ? box.name : 'Unassigned',
          total_scans: totalScans,
          candidates: candidateBreakdown,
          scanners: assignedScanners.map(s => s.name),
        };
      }).filter(r => r.box_id !== null || r.total_scans > 0);
    };

    // Per-pass breakdown
    const passSummaries = passes.map(p => ({
      pass_id: p.id,
      pass_number: p.pass_number,
      status: p.status,
      boxes: buildBoxBreakdown(sc => sc.pass_id === p.id),
    }));

    res.json({ passes: passSummaries });
  } catch (err) {
    console.error('Box counts error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
