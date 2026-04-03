const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db');

const router = Router();

// GET /api/public/:electionId — Election overview with all races and released rounds
router.get('/:electionId', async (req, res) => {
  try {
    const { rows: [election] } = await db.query(
      'SELECT * FROM elections WHERE id = $1', [req.params.electionId]
    );
    if (!election) return res.status(404).json({ error: 'Election not found' });

    const { rows: races } = await db.query(
      'SELECT * FROM races WHERE election_id = $1 ORDER BY display_order',
      [election.id]
    );

    // For each race, get released rounds with results
    for (const race of races) {
      const { rows: rounds } = await db.query(
        "SELECT * FROM rounds WHERE race_id = $1 AND status = 'released' ORDER BY round_number",
        [race.id]
      );

      for (const round of rounds) {
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

      race.rounds = rounds;

      // Determine race status label
      const { rows: allRounds } = await db.query(
        'SELECT status FROM rounds WHERE race_id = $1 ORDER BY round_number DESC LIMIT 1',
        [race.id]
      );
      if (race.status === 'complete') {
        race.status_label = 'Race Complete';
      } else if (allRounds.length > 0) {
        const latest = allRounds[0];
        const releasedCount = rounds.length;
        if (latest.status === 'released') {
          race.status_label = `Round ${releasedCount} Complete`;
        } else {
          race.status_label = `Round ${releasedCount + 1} in Progress`;
        }
      } else {
        race.status_label = 'Not Started';
      }
    }

    // Get TV QR setting
    const tvQr = election.tv_qr_enabled
      ? { enabled: true, url: election.tv_qr_url }
      : { enabled: false, url: null };

    res.json({ ...election, races, tv_qr: tvQr });
  } catch (err) {
    console.error('Public election overview error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/public/:electionId/races/:raceId — Race detail with released rounds
router.get('/:electionId/races/:raceId', async (req, res) => {
  try {
    const { rows: [race] } = await db.query(
      'SELECT * FROM races WHERE id = $1 AND election_id = $2',
      [req.params.raceId, req.params.electionId]
    );
    if (!race) return res.status(404).json({ error: 'Race not found' });

    const { rows: rounds } = await db.query(
      "SELECT * FROM rounds WHERE race_id = $1 AND status = 'released' ORDER BY round_number",
      [race.id]
    );

    for (const round of rounds) {
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

    res.json({ ...race, rounds });
  } catch (err) {
    console.error('Public race detail error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/public/:electionId/rounds/:roundId — Round detail: results + ballot SNs
router.get('/:electionId/rounds/:roundId', async (req, res) => {
  try {
    const { rows: [round] } = await db.query(
      "SELECT * FROM rounds WHERE id = $1 AND status = 'released'",
      [req.params.roundId]
    );
    if (!round) return res.status(404).json({ error: 'Round not found or not yet released' });

    const { rows: [race] } = await db.query('SELECT * FROM races WHERE id = $1', [round.race_id]);
    if (race.election_id !== parseInt(req.params.electionId)) {
      return res.status(404).json({ error: 'Round not found' });
    }

    const { rows: results } = await db.query(
      `SELECT rr.*, c.name as candidate_name
       FROM round_results rr
       JOIN candidates c ON c.id = rr.candidate_id
       WHERE rr.round_id = $1
       ORDER BY rr.vote_count DESC`,
      [round.id]
    );

    const { rows: serials } = await db.query(
      "SELECT serial_number FROM ballot_serials WHERE round_id = $1 AND status = 'counted' ORDER BY serial_number",
      [round.id]
    );

    res.json({ round, race, results, serial_numbers: serials.map(s => s.serial_number) });
  } catch (err) {
    console.error('Public round detail error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/public/:electionId/ballots/:serialNumber — Front ballot image
router.get('/:electionId/ballots/:serialNumber', async (req, res) => {
  try {
    const sn = req.params.serialNumber.toUpperCase();

    // Find the ballot serial in a released round within this election
    const { rows } = await db.query(
      `SELECT bs.id as bs_id, bs.round_id, r.race_id, rc.election_id, s.front_image_path
       FROM ballot_serials bs
       JOIN rounds r ON r.id = bs.round_id AND r.status = 'released'
       JOIN races rc ON rc.id = r.race_id AND rc.election_id = $1
       LEFT JOIN scans s ON s.ballot_serial_id = bs.id
       WHERE bs.serial_number = $2
       LIMIT 1`,
      [req.params.electionId, sn]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Ballot not found or results not yet released' });
    }

    const row = rows[0];

    if (!row.front_image_path || !fs.existsSync(row.front_image_path)) {
      return res.status(404).json({
        error: 'Ballot image not available',
        serial_number: sn,
        round_id: row.round_id,
      });
    }

    res.sendFile(path.resolve(row.front_image_path));
  } catch (err) {
    console.error('Public ballot image error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/public/:electionId/search?sn=XXXXXXXX — Search for ballot SN
router.get('/:electionId/search', async (req, res) => {
  try {
    const sn = (req.query.sn || '').toUpperCase();
    if (sn.length < 8) {
      return res.status(400).json({ error: 'Serial number must be at least 8 characters' });
    }

    const { rows } = await db.query(
      `SELECT bs.serial_number, bs.round_id, bs.status as ballot_status,
              r.round_number, r.status as round_status,
              rc.id as race_id, rc.name as race_name
       FROM ballot_serials bs
       JOIN rounds r ON r.id = bs.round_id AND r.status = 'released'
       JOIN races rc ON rc.id = r.race_id AND rc.election_id = $1
       WHERE bs.serial_number = $2`,
      [req.params.electionId, sn]
    );

    if (rows.length === 0) {
      return res.json({ found: false, message: 'Ballot not found or results not yet released' });
    }

    const row = rows[0];
    res.json({
      found: true,
      serial_number: row.serial_number,
      round_id: row.round_id,
      round_number: row.round_number,
      race_name: row.race_name,
      ballot_status: row.ballot_status,
      image_url: `/api/public/${req.params.electionId}/ballots/${sn}`,
    });
  } catch (err) {
    console.error('Public SN search error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
