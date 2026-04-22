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
    if (!election) return res.status(404).json({ error: 'Election event not found' });

    const { rows: races } = await db.query(
      'SELECT * FROM races WHERE election_id = $1 AND dashboard_visible = true ORDER BY display_order',
      [election.id]
    );

    // For each race, get released rounds with results
    for (const race of races) {
      const { rows: rounds } = await db.query(
        "SELECT * FROM rounds WHERE race_id = $1 AND published_at IS NOT NULL ORDER BY round_number",
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

      // Get next unpublished round (if any) for display
      const { rows: [nextRound] } = await db.query(
        "SELECT id, round_number, status, paper_color FROM rounds WHERE race_id = $1 AND published_at IS NULL AND status != 'canceled' ORDER BY round_number LIMIT 1",
        [race.id]
      );
      race.next_round = nextRound || null;

      // Get all candidates for this race (for pre-voting display)
      const { rows: candidates } = await db.query(
        "SELECT id, name, display_order, status FROM candidates WHERE race_id = $1 ORDER BY display_order",
        [race.id]
      );
      race.candidates = candidates;

      // Get current active round — prioritize in-progress statuses, then fall back to latest non-canceled
      const { rows: activeRounds } = await db.query(
        `SELECT id, round_number, status, paper_color FROM rounds
         WHERE race_id = $1 AND status != 'canceled'
         ORDER BY round_number DESC`,
        [race.id]
      );
      const inProgressRound = activeRounds.find(r =>
        ['voting_open', 'voting_closed', 'tallying'].includes(r.status)
      );
      race.current_round = inProgressRound || activeRounds[0] || null;

      // Get eliminated candidates
      const { rows: withdrawnCandidates } = await db.query(
        "SELECT id, name, withdrawn_at FROM candidates WHERE race_id = $1 AND status = 'withdrawn' ORDER BY withdrawn_at",
        [race.id]
      );
      race.eliminated = withdrawnCandidates;

      // Get race outcome — only expose publicly after all finalized rounds are published
      const { rows: [unpublishedFinalized] } = await db.query(
        "SELECT id FROM rounds WHERE race_id = $1 AND status = 'round_finalized' AND published_at IS NULL LIMIT 1",
        [race.id]
      );
      const outcomePublished = race.outcome && !unpublishedFinalized;

      if (outcomePublished) {
        const outcomeCandidate = race.outcome_candidate_id
          ? (await db.query('SELECT name FROM candidates WHERE id = $1', [race.outcome_candidate_id])).rows[0]
          : null;
        race.outcome_details = {
          outcome: race.outcome,
          candidate_name: outcomeCandidate?.name || null,
          notes: race.outcome_notes,
        };
      }

      // Determine race status label
      // Get all non-canceled rounds, ordered by most advanced first
      const { rows: allRounds } = await db.query(
        `SELECT status, published_at, round_number FROM rounds
         WHERE race_id = $1 AND status != 'canceled'
         ORDER BY round_number DESC`,
        [race.id]
      );
      // Prioritize in-progress rounds for the status label
      const activeRound = allRounds.find(r =>
        ['voting_open', 'voting_closed', 'tallying'].includes(r.status)
      ) || allRounds.find(r =>
        !['pending_needs_action', 'ready'].includes(r.status)
      ) || allRounds[0] || null;
      const publishedCount = rounds.length; // rounds already filtered to published_at IS NOT NULL

      if (outcomePublished && race.outcome === 'winner') {
        const winnerName = race.outcome_details?.candidate_name || 'TBD';
        race.status_label = `Winner: ${winnerName}`;
      } else if (outcomePublished && race.outcome === 'advances_primary') {
        race.status_label = 'Advances to Primary';
      } else if (outcomePublished && race.outcome === 'closed') {
        race.status_label = 'Race Closed';
      } else if (outcomePublished && race.status === 'results_finalized') {
        race.status_label = 'Race Complete';
      } else if (activeRound) {
        if (activeRound.status === 'voting_open') {
          race.status_label = 'Voting Open';
        } else if (activeRound.status === 'voting_closed') {
          race.status_label = 'Voting Closed';
        } else if (activeRound.status === 'tallying') {
          race.status_label = 'Tallying';
        } else if (activeRound.status === 'round_finalized' && !activeRound.published_at) {
          race.status_label = 'Results Announced Soon';
        } else if (publishedCount > 0) {
          race.status_label = `Round ${publishedCount} Complete`;
        } else {
          race.status_label = 'Awaiting Vote';
        }
      } else {
        race.status_label = 'Awaiting Vote';
      }
    }

    // Strip unpublished outcome fields from races before sending
    for (const race of races) {
      if (!race.outcome_details) {
        delete race.outcome;
        delete race.outcome_candidate_id;
        delete race.outcome_notes;
        delete race.outcome_at;
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
      "SELECT * FROM rounds WHERE race_id = $1 AND published_at IS NOT NULL ORDER BY round_number",
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

    // Strip outcome if any finalized round is still unpublished
    const { rows: [unpub] } = await db.query(
      "SELECT id FROM rounds WHERE race_id = $1 AND status = 'round_finalized' AND published_at IS NULL LIMIT 1",
      [race.id]
    );
    if (unpub || !race.outcome) {
      delete race.outcome;
      delete race.outcome_candidate_id;
      delete race.outcome_notes;
      delete race.outcome_at;
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
      "SELECT * FROM rounds WHERE id = $1 AND published_at IS NOT NULL",
      [req.params.roundId]
    );
    if (!round) return res.status(404).json({ error: 'Round not found or not yet released' });

    const { rows: [race] } = await db.query('SELECT * FROM races WHERE id = $1', [round.race_id]);
    if (race.election_id !== parseInt(req.params.electionId)) {
      return res.status(404).json({ error: 'Round not found' });
    }

    const { rows: [election] } = await db.query(
      'SELECT public_search_enabled, public_browse_enabled FROM elections WHERE id = $1',
      [race.election_id]
    );

    const { rows: results } = await db.query(
      `SELECT rr.*, c.name as candidate_name
       FROM round_results rr
       JOIN candidates c ON c.id = rr.candidate_id
       WHERE rr.round_id = $1
       ORDER BY rr.vote_count DESC`,
      [round.id]
    );

    const { rows: serials } = await db.query(
      "SELECT serial_number, status FROM ballot_serials WHERE round_id = $1 AND status IN ('counted', 'spoiled') ORDER BY serial_number",
      [round.id]
    );

    res.json({ round, race, election, results, serial_numbers: serials.map(s => s.serial_number), ballots: serials });
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
      `SELECT bs.id as bs_id, bs.round_id, r.race_id, rc.election_id,
              COALESCE(s.image_path, s.front_image_path) as image_path
       FROM ballot_serials bs
       JOIN rounds r ON r.id = bs.round_id AND r.published_at IS NOT NULL
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

    if (!row.image_path || !fs.existsSync(row.image_path)) {
      return res.status(404).json({
        error: 'Ballot image not available',
        serial_number: sn,
        round_id: row.round_id,
      });
    }

    res.sendFile(path.resolve(row.image_path));
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

    // Check if search is enabled at the election level
    const { rows: [electionFlags] } = await db.query(
      'SELECT public_search_enabled, public_browse_enabled FROM elections WHERE id = $1',
      [req.params.electionId]
    );
    if (electionFlags && electionFlags.public_search_enabled === false) {
      return res.json({ found: false, message: 'Ballot search is not enabled for this election' });
    }

    const { rows } = await db.query(
      `SELECT bs.serial_number, bs.round_id, bs.status as ballot_status,
              r.round_number, r.status as round_status,
              rc.id as race_id, rc.name as race_name,
              c.name as voted_for
       FROM ballot_serials bs
       JOIN rounds r ON r.id = bs.round_id AND r.published_at IS NOT NULL
       JOIN races rc ON rc.id = r.race_id AND rc.election_id = $1
       LEFT JOIN scans s ON s.ballot_serial_id = bs.id
       LEFT JOIN candidates c ON c.id = s.candidate_id
       WHERE bs.serial_number = $2`,
      [req.params.electionId, sn]
    );

    if (rows.length === 0) {
      return res.json({ found: false, message: 'Ballot not found or results not yet released' });
    }

    const row = rows[0];
    const browseEnabled = electionFlags?.public_browse_enabled === true;

    // Get prev/next serial numbers for navigation (include spoiled)
    const { rows: allSerials } = await db.query(
      "SELECT serial_number FROM ballot_serials WHERE round_id = $1 AND status IN ('counted', 'spoiled') ORDER BY serial_number",
      [row.round_id]
    );
    const snList = allSerials.map(s => s.serial_number);
    const idx = snList.indexOf(row.serial_number);
    const prev_sn = idx > 0 ? snList[idx - 1] : null;
    const next_sn = idx < snList.length - 1 ? snList[idx + 1] : null;

    res.json({
      found: true,
      serial_number: row.serial_number,
      round_id: row.round_id,
      round_number: row.round_number,
      race_name: row.race_name,
      ballot_status: row.ballot_status,
      voted_for: row.voted_for || null,
      ballot_index: idx + 1,
      ballot_total: snList.length,
      prev_sn: browseEnabled ? prev_sn : null,
      next_sn: browseEnabled ? next_sn : null,
      public_browse_enabled: browseEnabled,
      image_url: `/api/public/${req.params.electionId}/ballots/${sn}`,
    });
  } catch (err) {
    console.error('Public SN search error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
