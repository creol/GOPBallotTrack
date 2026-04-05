const { Router } = require('express');
const crypto = require('crypto');
const db = require('../db');

const router = Router();

const SN_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function generateSN() {
  const bytes = crypto.randomBytes(8);
  let sn = '';
  for (let i = 0; i < 8; i++) sn += SN_CHARSET[bytes[i] % SN_CHARSET.length];
  return sn;
}

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

    res.setHeader('Content-Disposition', `attachment; filename="election-${electionId}-export.json"`);
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

        // Try to restore original serial numbers; generate fresh ones only on conflict
        for (const sn of (roundData.serials || [])) {
          const { rows: [existing] } = await db.query(
            'SELECT id FROM ballot_serials WHERE serial_number = $1', [sn]
          );
          const finalSN = existing ? generateSN() : sn;
          await db.query(
            `INSERT INTO ballot_serials (round_id, serial_number, status)
             VALUES ($1, $2, 'unused')`,
            [round.id, finalSN]
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

// POST /api/admin/rounds/:id/generate-test-ballots — Generate filled ballot images from real ballot rendering
router.post('/rounds/:id/generate-test-ballots', async (req, res) => {
  try {
    const roundId = parseInt(req.params.id);
    const { count, bad_fill_percentage } = req.body;
    const numBallots = Math.min(parseInt(count) || 10, 500);
    const badFillPct = Math.min(Math.max(parseInt(bad_fill_percentage) || 0, 0), 100);

    const sharp = require('sharp');
    const { execSync } = require('child_process');
    const fs = require('fs');
    const path = require('path');
    const { renderSingleBallotPdf } = require('../pdf/ballotGenerator');

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

    // Load ballot spec for oval positions
    const specPath = path.join(__dirname, '..', '..', '..', 'uploads', 'elections',
      String(race.election_id), 'rounds', String(roundId), 'ballot-spec.json');
    if (!fs.existsSync(specPath)) {
      return res.status(400).json({ error: 'Ballot spec not found — generate ballot PDF first' });
    }
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));

    const BALLOT_SIZES_PX = {
      letter: { w: 2550, h: 3300 },
      half_letter: { w: 1650, h: 2550 },
      quarter_letter: { w: 1275, h: 1650 },
      eighth_letter: { w: 825, h: 1275 },
    };
    const ballotDims = BALLOT_SIZES_PX[spec.ballot_size] || BALLOT_SIZES_PX.quarter_letter;

    // Output directories
    const outDir = path.join(__dirname, '..', '..', '..', 'data', 'scans', 'test-ballots', `round-${roundId}`);
    const tmpDir = path.join(outDir, 'tmp');
    fs.mkdirSync(outDir, { recursive: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    const actualCount = Math.min(numBallots, unusedSerials.length);
    const results = [];

    for (let i = 0; i < actualCount; i++) {
      const serial = unusedSerials[i];
      const isBadFill = Math.random() * 100 < badFillPct;
      const votedCandidate = candidates[Math.floor(Math.random() * candidates.length)];

      // 1. Render a real single-ballot PDF for this serial
      const pdfFile = path.join(tmpDir, `${serial.serial_number}.pdf`);
      await renderSingleBallotPdf({
        roundId,
        serialNumber: serial.serial_number,
        outputPath: pdfFile,
        sizeKey: spec.ballot_size,
      });

      // 2. Convert PDF to JPG using pdftoppm
      const ppmPrefix = path.join(tmpDir, serial.serial_number);
      try {
        execSync(`pdftoppm -jpeg -r 300 -singlefile "${pdfFile}" "${ppmPrefix}"`, { timeout: 10000 });
      } catch (err) {
        console.error(`[TestBallots] pdftoppm failed for ${serial.serial_number}:`, err.message);
        continue;
      }

      const renderedJpg = `${ppmPrefix}.jpg`;
      if (!fs.existsSync(renderedJpg)) continue;

      // 3. Resize to exact spec dimensions and overlay filled oval
      const composites = [];
      for (const cand of spec.candidates) {
        if (cand.candidate_id === votedCandidate.id) {
          const oval = cand.oval;
          let fillOpacity;
          if (isBadFill) {
            const badType = Math.random();
            if (badType < 0.33) fillOpacity = 180;
            else if (badType < 0.66) fillOpacity = 140;
            else fillOpacity = 100;
          } else {
            fillOpacity = 30;
          }

          const ovalW = Math.round(oval.width * 0.55);
          const ovalH = Math.round(oval.height * 0.6);
          const ovalSvg = Buffer.from(
            `<svg width="${ovalW}" height="${ovalH}">
              <ellipse cx="${ovalW / 2}" cy="${ovalH / 2}" rx="${ovalW / 2 - 1}" ry="${ovalH / 2 - 1}"
                fill="rgb(${fillOpacity},${fillOpacity},${fillOpacity})" />
            </svg>`
          );

          composites.push({
            input: ovalSvg,
            left: Math.round(oval.x + (oval.width - ovalW) / 2),
            top: Math.round(oval.y + (oval.height - ovalH) / 2),
          });
        }
      }

      const outputPath = path.join(outDir, `${serial.serial_number}.jpg`);
      await sharp(renderedJpg)
        .resize(ballotDims.w, ballotDims.h)
        .composite(composites)
        .jpeg({ quality: 90 })
        .toFile(outputPath);

      // Clean up temp files
      try { fs.unlinkSync(pdfFile); } catch {}
      try { fs.unlinkSync(renderedJpg); } catch {}

      results.push({
        serial_number: serial.serial_number,
        voted_for: votedCandidate.name,
        bad_fill: isBadFill,
      });
    }

    // Clean up tmp dir
    try { fs.rmdirSync(tmpDir); } catch {}

    res.json({
      message: `Generated ${results.length} test ballot images`,
      output_dir: outDir,
      total: results.length,
      bad_fills: results.filter(r => r.bad_fill).length,
      preview_url: results.length > 0 ? `/api/admin/rounds/${roundId}/test-ballot-preview` : null,
      ballots: results,
    });
  } catch (err) {
    console.error('Generate test ballots error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// GET /api/admin/rounds/:id/test-ballot-preview — Preview a generated test ballot
router.get('/rounds/:id/test-ballot-preview', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const roundId = req.params.id;
  const outDir = path.join(__dirname, '..', '..', '..', 'data', 'scans', 'test-ballots', `round-${roundId}`);

  if (!fs.existsSync(outDir)) {
    return res.status(404).json({ error: 'No test ballots generated yet' });
  }

  const files = fs.readdirSync(outDir).filter(f => f.endsWith('.jpg'));
  if (files.length === 0) {
    return res.status(404).json({ error: 'No test ballot images found' });
  }

  res.sendFile(path.join(outDir, files[0]));
});

module.exports = router;
