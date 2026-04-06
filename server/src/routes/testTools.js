const { Router } = require('express');
const db = require('../db');

const router = Router();

// GET /api/admin/elections/:id/export-json — Export election event as JSON
router.get('/elections/:id/export-json', async (req, res) => {
  try {
    const electionId = parseInt(req.params.id);

    const { rows: [election] } = await db.query('SELECT * FROM elections WHERE id = $1', [electionId]);
    if (!election) return res.status(404).json({ error: 'Election not found' });

    const { rows: races } = await db.query(
      'SELECT * FROM races WHERE election_id = $1 ORDER BY display_order', [electionId]
    );

    for (const race of races) {
      const { rows: candidates } = await db.query(
        'SELECT * FROM candidates WHERE race_id = $1 ORDER BY display_order', [race.id]
      );
      race.candidates = candidates;

      const { rows: rounds } = await db.query(
        'SELECT * FROM rounds WHERE race_id = $1 ORDER BY round_number', [race.id]
      );

      for (const round of rounds) {
        const { rows: serials } = await db.query(
          'SELECT serial_number, status FROM ballot_serials WHERE round_id = $1 ORDER BY serial_number',
          [round.id]
        );
        round.serials = serials;
      }
      race.rounds = rounds;
    }

    const { rows: ballotBoxes } = await db.query(
      'SELECT * FROM ballot_boxes WHERE election_id = $1 ORDER BY created_at', [electionId]
    );

    const { rows: [design] } = await db.query(
      'SELECT config FROM ballot_designs WHERE election_id = $1', [electionId]
    );

    const exportData = {
      _format: 'ballottrack_election_export',
      _version: 1,
      _exported_at: new Date().toISOString(),
      election: {
        name: election.name,
        date: election.date,
        description: election.description,
      },
      ballot_design: design?.config || null,
      ballot_boxes: ballotBoxes.map(b => ({ name: b.name })),
      races: races.map(race => ({
        name: race.name,
        threshold_type: race.threshold_type,
        threshold_value: race.threshold_value,
        display_order: race.display_order,
        ballot_count: race.ballot_count,
        max_rounds: race.max_rounds,
        candidates: race.candidates.map(c => ({
          name: c.name,
          display_order: c.display_order,
          status: c.status,
        })),
        rounds: race.rounds.map(r => ({
          round_number: r.round_number,
          paper_color: r.paper_color,
          serials: r.serials.map(s => s.serial_number),
        })),
      })),
    };

    const safeName = election.name.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}_${timestamp}.json"`);
    res.json(exportData);
  } catch (err) {
    console.error('Export election error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/import-election — Import election event from JSON
router.post('/import-election', async (req, res) => {
  try {
    const data = req.body;
    if (!data._format || data._format !== 'ballottrack_election_export') {
      return res.status(400).json({ error: 'Invalid export format' });
    }

    // Create election
    const { rows: [election] } = await db.query(
      `INSERT INTO elections (name, date, description)
       VALUES ($1, $2, $3) RETURNING *`,
      [data.election.name + ' (Imported)', data.election.date, data.election.description]
    );

    // Create ballot boxes
    for (const box of (data.ballot_boxes || [])) {
      await db.query(
        'INSERT INTO ballot_boxes (election_id, name) VALUES ($1, $2)',
        [election.id, box.name]
      );
    }

    // Save ballot design
    if (data.ballot_design) {
      await db.query(
        `INSERT INTO ballot_designs (election_id, config) VALUES ($1, $2)
         ON CONFLICT (election_id) DO UPDATE SET config = $2`,
        [election.id, JSON.stringify(data.ballot_design)]
      );
    }

    // Create races, candidates, rounds, serials
    for (const raceData of (data.races || [])) {
      const { rows: [race] } = await db.query(
        `INSERT INTO races (election_id, name, threshold_type, threshold_value, display_order, ballot_count, max_rounds)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [election.id, raceData.name, raceData.threshold_type || 'majority',
         raceData.threshold_value || null, raceData.display_order || 0,
         raceData.ballot_count || null, raceData.max_rounds || null]
      );

      for (const candData of (raceData.candidates || [])) {
        await db.query(
          `INSERT INTO candidates (race_id, name, display_order, status)
           VALUES ($1, $2, $3, $4)`,
          [race.id, candData.name, candData.display_order || 0, candData.status || 'active']
        );
      }

      for (const roundData of (raceData.rounds || [])) {
        const { rows: [round] } = await db.query(
          `INSERT INTO rounds (race_id, round_number, paper_color)
           VALUES ($1, $2, $3) RETURNING *`,
          [race.id, roundData.round_number, roundData.paper_color]
        );

        // Restore original serial numbers exactly (uniqueness is per-round, not global)
        for (const sn of (roundData.serials || [])) {
          await db.query(
            `INSERT INTO ballot_serials (round_id, serial_number, status)
             VALUES ($1, $2, 'unused')`,
            [round.id, sn]
          );
        }
      }
    }

    res.status(201).json({
      message: 'Election imported successfully',
      election_id: election.id,
      name: election.name,
    });
  } catch (err) {
    console.error('Import election error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// POST /api/admin/rounds/:id/generate-test-ballots — Generate a PDF of test ballots with random filled ovals
router.post('/rounds/:id/generate-test-ballots', async (req, res) => {
  try {
    const roundId = parseInt(req.params.id);
    const { count, size } = req.body;
    const numBallots = Math.min(parseInt(count) || 10, 500);

    const PDFDocument = require('pdfkit');
    const fs = require('fs');
    const path = require('path');
    const { SIZES } = require('../pdf/ballotGenerator');

    // Get round data
    const { rows: [round] } = await db.query('SELECT * FROM rounds WHERE id = $1', [roundId]);
    if (!round) return res.status(404).json({ error: 'Round not found' });

    const { rows: [race] } = await db.query('SELECT * FROM races WHERE id = $1', [round.race_id]);
    const { rows: candidates } = await db.query(
      "SELECT * FROM candidates WHERE race_id = $1 AND status = 'active' ORDER BY display_order",
      [round.race_id]
    );

    // Get unused serial numbers
    const { rows: unusedSerials } = await db.query(
      "SELECT * FROM ballot_serials WHERE round_id = $1 AND status = 'unused' ORDER BY random() LIMIT $2",
      [roundId, numBallots]
    );

    if (unusedSerials.length === 0) {
      return res.status(400).json({ error: 'No unused serial numbers available for this round' });
    }

    const sizeKey = size || 'quarter_letter';
    const ballotSize = SIZES[sizeKey];
    if (!ballotSize) return res.status(400).json({ error: 'Invalid ballot size' });

    // We need renderBallot and loadDesignConfig — load them fresh to get the internal function
    const ballotGen = require('../pdf/ballotGenerator');
    const { loadDesignConfig, fetchBallotData, renderBallot } = ballotGen;

    // Output directory
    const outDir = path.join(__dirname, '..', '..', '..', 'data', 'scans', 'test-ballots', `round-${roundId}`);
    fs.mkdirSync(outDir, { recursive: true });

    const pdfPath = path.join(outDir, 'test-ballots.pdf');
    const actualCount = Math.min(numBallots, unusedSerials.length);
    const results = [];

    const { perPage, cols, rows: gridRows } = ballotSize;
    const isEighth = sizeKey === 'eighth_letter';
    const cellW = isEighth ? (4.25 * 72) : ballotSize.width;
    const cellH = isEighth ? (2.75 * 72) : ballotSize.height;
    const LETTER_W = 8.5 * 72;
    const LETTER_H = 11 * 72;
    const gridW = cols * cellW;
    const gridH = gridRows * cellH;
    const padX = (LETTER_W - gridW) / 2;
    const padY = (LETTER_H - gridH) / 2;

    // Fetch shared data
    const data = await fetchBallotData(roundId);
    const cfg = await loadDesignConfig(data.election.id, roundId);

    const doc = new PDFDocument({ size: 'LETTER', margin: 0, autoFirstPage: false });
    const pdfStream = fs.createWriteStream(pdfPath);
    doc.pipe(pdfStream);

    if (sizeKey === 'letter') {
      for (let i = 0; i < actualCount; i++) {
        const serial = unusedSerials[i];
        const votedCandidate = candidates[Math.floor(Math.random() * candidates.length)];
        doc.addPage({ size: 'LETTER', margin: 0 });
        await renderBallot(doc, 0, 0, ballotSize.width, ballotSize.height, {
          ...data, serialNumber: serial.serial_number, sizeKey, logoPath: null, cfg,
          filledCandidateId: votedCandidate.id, testMode: true,
        });
        results.push({ serial_number: serial.serial_number, voted_for: votedCandidate.name });
      }
    } else {
      let slotIndex = 0;
      for (let i = 0; i < actualCount; i++) {
        if (slotIndex % perPage === 0) {
          doc.addPage({ size: 'LETTER', margin: 0 });
        }
        const serial = unusedSerials[i];
        const votedCandidate = candidates[Math.floor(Math.random() * candidates.length)];
        const posOnPage = slotIndex % perPage;
        const col = posOnPage % cols;
        const row = Math.floor(posOnPage / cols);
        const ox = padX + col * cellW;
        const oy = padY + row * cellH;
        const ballotW = isEighth ? cellW : ballotSize.width;
        const ballotH = isEighth ? cellH : ballotSize.height;

        await renderBallot(doc, ox, oy, ballotW, ballotH, {
          ...data, serialNumber: serial.serial_number, sizeKey, logoPath: null, cfg,
          filledCandidateId: votedCandidate.id, testMode: true,
        });

        if (perPage > 1) {
          doc.save();
          doc.lineWidth(0.25).strokeColor('#ccc');
          doc.rect(ox, oy, ballotW, ballotH).stroke();
          doc.restore();
          doc.strokeColor('#000');
        }

        results.push({ serial_number: serial.serial_number, voted_for: votedCandidate.name });
        slotIndex++;
      }
    }

    doc.end();
    await new Promise((resolve, reject) => {
      pdfStream.on('finish', resolve);
      pdfStream.on('error', reject);
    });

    res.json({
      message: `Generated ${results.length} test ballots`,
      total: results.length,
      pdf_url: `/api/admin/rounds/${roundId}/test-ballot-pdf`,
      ballots: results,
    });
  } catch (err) {
    console.error('Generate test ballots error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// GET /api/admin/rounds/:id/test-ballot-pdf — Download the test ballot PDF
router.get('/rounds/:id/test-ballot-pdf', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const roundId = req.params.id;
  const pdfPath = path.join(__dirname, '..', '..', '..', 'data', 'scans', 'test-ballots', `round-${roundId}`, 'test-ballots.pdf');

  if (!fs.existsSync(pdfPath)) {
    return res.status(404).json({ error: 'No test ballots generated yet' });
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(pdfPath);
});

module.exports = router;
