const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { generateBallots, SIZES } = require('../pdf/ballotGenerator');

const router = Router();

// Multer for optional logo upload
const upload = multer({ dest: path.join(__dirname, '..', '..', '..', 'uploads', 'logos') });

// GET /api/admin/rounds/:id/ballot-status — Check if ballots already exist
router.get('/rounds/:id/ballot-status', async (req, res) => {
  try {
    const roundId = parseInt(req.params.id);
    const { rows: [{ count }] } = await db.query(
      'SELECT COUNT(*) as count FROM ballot_serials WHERE round_id = $1', [roundId]
    );
    const serialCount = parseInt(count);

    const { rows: [round] } = await db.query(
      'SELECT ballot_pdf_generated_at, ballot_design_overrides FROM rounds WHERE id = $1', [roundId]
    );

    const outDir = await getOutputDir(roundId);
    const pdfExists = outDir && fs.existsSync(path.join(outDir, 'ballots.pdf'));

    res.json({
      has_serials: serialCount > 0,
      serial_count: serialCount,
      pdf_exists: !!pdfExists,
      generated_at: round?.ballot_pdf_generated_at || null,
      has_overrides: !!round?.ballot_design_overrides,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/rounds/:id/generate-ballots
router.post('/rounds/:id/generate-ballots', upload.single('logo'), async (req, res) => {
  try {
    const roundId = parseInt(req.params.id);
    const quantity = parseInt(req.body.quantity) || 0;
    const sizeKey = req.body.size || 'letter';
    const logoPath = req.file ? req.file.path : null;
    const confirmRegenerate = req.body.confirm_regenerate === 'true';

    // Check existing state
    const { rows: [{ count: existingSNCount }] } = await db.query(
      'SELECT COUNT(*) as count FROM ballot_serials WHERE round_id = $1', [roundId]
    );
    const hasExistingSNs = parseInt(existingSNCount) > 0;

    // Only require quantity if no pre-existing SNs
    if (!hasExistingSNs && (!quantity || quantity < 1)) {
      return res.status(400).json({ error: 'quantity must be at least 1' });
    }
    if (!SIZES[sizeKey]) {
      return res.status(400).json({ error: `Invalid size. Valid: ${Object.keys(SIZES).join(', ')}` });
    }

    // Only block if a PDF already exists (not just SNs — SNs are pre-generated at race creation)
    const outDir = await getOutputDir(roundId);
    const pdfExists = outDir && fs.existsSync(path.join(outDir, 'ballots.pdf'));
    if (pdfExists && !confirmRegenerate) {
      return res.status(409).json({
        error: 'Ballot PDF already exists for this round',
        existing_count: parseInt(existingSNCount),
        message: 'Regenerating will overwrite the existing PDF. If ballots have already been printed, the serial numbers will remain the same but the layout may change. Send confirm_regenerate=true to proceed.',
      });
    }

    const result = await generateBallots({ roundId, quantity, sizeKey, logoPath });

    // Track generation and auto-set round to ready
    const pdfPath = path.join(await getOutputDir(roundId), 'ballots.pdf');
    await db.query(
      `UPDATE rounds SET
        ballot_pdf_generated_at = NOW(),
        ballot_pdf_path = $1,
        status = CASE WHEN status = 'pending_needs_action' THEN 'ready' ELSE status END
       WHERE id = $2`,
      [pdfPath, roundId]
    );

    res.json({
      message: `Generated ${result.serials.length} ballots`,
      serial_count: result.serials.length,
      pdf_url: `/api/admin/rounds/${roundId}/ballot-pdf`,
      zip_url: `/api/admin/rounds/${roundId}/ballot-data`,
      preview_url: `/api/admin/rounds/${roundId}/ballot-preview`,
    });
  } catch (err) {
    console.error('Generate ballots error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// POST /api/admin/elections/:id/generate-all-ballots — Generate PDFs for all rounds in the election
router.post('/elections/:id/generate-all-ballots', async (req, res) => {
  try {
    const electionId = parseInt(req.params.id);
    const sizeKey = req.body.size || 'letter';
    if (!SIZES[sizeKey]) {
      return res.status(400).json({ error: `Invalid size. Valid: ${Object.keys(SIZES).join(', ')}` });
    }

    const { rows: races } = await db.query(
      'SELECT * FROM races WHERE election_id = $1 ORDER BY display_order', [electionId]
    );

    const results = [];
    for (const race of races) {
      const { rows: rounds } = await db.query(
        'SELECT * FROM rounds WHERE race_id = $1 ORDER BY round_number', [race.id]
      );

      for (const round of rounds) {
        // Check if SNs exist
        const { rows: [{ count }] } = await db.query(
          'SELECT COUNT(*) as count FROM ballot_serials WHERE round_id = $1', [round.id]
        );
        if (parseInt(count) === 0) continue; // skip rounds with no SNs

        try {
          const result = await generateBallots({ roundId: round.id, quantity: null, sizeKey, logoPath: null });

          // Mark PDF as generated and auto-set round to ready
          await db.query(
            `UPDATE rounds SET
              ballot_pdf_generated_at = NOW(),
              ballot_pdf_path = $1,
              status = CASE WHEN status = 'pending_needs_action' THEN 'ready' ELSE status END
             WHERE id = $2`,
            [result.pdfPath, round.id]
          );

          results.push({
            race: race.name,
            round: round.round_number,
            round_id: round.id,
            serial_count: result.serials.length,
            status: 'generated',
            pdf_url: `/api/admin/rounds/${round.id}/ballot-pdf`,
          });
        } catch (err) {
          results.push({
            race: race.name,
            round: round.round_number,
            round_id: round.id,
            status: 'error',
            error: err.message,
          });
        }
      }
    }

    // Save the size as the election's last-used size
    await db.query(
      `INSERT INTO ballot_designs (election_id, config) VALUES ($1, $2)
       ON CONFLICT (election_id) DO UPDATE SET config = ballot_designs.config || $2, updated_at = NOW()`,
      [electionId, JSON.stringify({ lastBallotSize: sizeKey })]
    );

    res.json({ message: `Generated ballot PDFs for ${results.filter(r => r.status === 'generated').length} rounds`, results });
  } catch (err) {
    console.error('Generate all ballots error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// GET /api/admin/rounds/:id/ballot-overrides — Get per-round design overrides
router.get('/rounds/:id/ballot-overrides', async (req, res) => {
  try {
    const { rows: [round] } = await db.query(
      'SELECT ballot_design_overrides, ballot_pdf_generated_at FROM rounds WHERE id = $1',
      [req.params.id]
    );
    if (!round) return res.status(404).json({ error: 'Round not found' });
    res.json({
      overrides: round.ballot_design_overrides || {},
      generated_at: round.ballot_pdf_generated_at,
    });
  } catch (err) {
    console.error('Get ballot overrides error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/rounds/:id/ballot-overrides — Save per-round design overrides
router.put('/rounds/:id/ballot-overrides', async (req, res) => {
  try {
    const { overrides } = req.body;
    if (!overrides || typeof overrides !== 'object') {
      return res.status(400).json({ error: 'overrides object is required' });
    }
    const { rows: [round] } = await db.query(
      'UPDATE rounds SET ballot_design_overrides = $1 WHERE id = $2 RETURNING ballot_design_overrides',
      [JSON.stringify(overrides), req.params.id]
    );
    if (!round) return res.status(404).json({ error: 'Round not found' });
    res.json({ overrides: round.ballot_design_overrides });
  } catch (err) {
    console.error('Save ballot overrides error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/elections/:id/ballot-list — List all rounds with ballot/PDF status
router.get('/elections/:id/ballot-list', async (req, res) => {
  try {
    const electionId = parseInt(req.params.id);
    const { rows: races } = await db.query(
      'SELECT * FROM races WHERE election_id = $1 ORDER BY display_order', [electionId]
    );

    const list = [];
    for (const race of races) {
      const { rows: rounds } = await db.query(
        'SELECT * FROM rounds WHERE race_id = $1 ORDER BY round_number', [race.id]
      );
      for (const round of rounds) {
        const { rows: [{ count }] } = await db.query(
          'SELECT COUNT(*) as count FROM ballot_serials WHERE round_id = $1', [round.id]
        );
        const outDir = path.join(__dirname, '..', '..', '..', 'uploads', 'elections', String(electionId), 'rounds', String(round.id));
        const pdfExists = fs.existsSync(path.join(outDir, 'ballots.pdf'));
        list.push({
          race_name: race.name,
          round_number: round.round_number,
          round_id: round.id,
          paper_color: round.paper_color,
          serial_count: parseInt(count),
          pdf_exists: pdfExists,
          pdf_url: pdfExists ? `/api/admin/rounds/${round.id}/ballot-pdf` : null,
        });
      }
    }

    res.json(list);
  } catch (err) {
    console.error('Ballot list error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/elections/:id/ballot-pdfs-zip — Download all ballot PDFs as a single ZIP
router.get('/elections/:id/ballot-pdfs-zip', async (req, res) => {
  try {
    const electionId = parseInt(req.params.id);
    const { rows: races } = await db.query(
      'SELECT * FROM races WHERE election_id = $1 ORDER BY display_order', [electionId]
    );

    const archiver = require('archiver');
    const archive = archiver('zip', { zlib: { level: 6 } });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="all-ballots-election-${electionId}.zip"`);
    archive.pipe(res);

    for (const race of races) {
      const raceDirName = race.name.toLowerCase().replace(/\s+/g, '-');
      const { rows: rounds } = await db.query(
        'SELECT * FROM rounds WHERE race_id = $1 ORDER BY round_number', [race.id]
      );
      for (const round of rounds) {
        const pdfPath = path.join(__dirname, '..', '..', '..', 'uploads', 'elections', String(electionId), 'rounds', String(round.id), 'ballots.pdf');
        if (fs.existsSync(pdfPath)) {
          archive.file(pdfPath, { name: `${raceDirName}/round-${round.round_number}-${round.paper_color || 'ballots'}.pdf` });
        }
      }
    }

    archive.finalize();
  } catch (err) {
    console.error('Ballot PDFs ZIP error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper: resolve output dir for a round
async function getOutputDir(roundId) {
  const { rows: [round] } = await db.query('SELECT * FROM rounds WHERE id = $1', [roundId]);
  if (!round) return null;
  const { rows: [race] } = await db.query('SELECT * FROM races WHERE id = $1', [round.race_id]);
  if (!race) return null;
  return path.join(__dirname, '..', '..', '..', 'uploads', 'elections', String(race.election_id), 'rounds', String(roundId));
}

// GET /api/admin/rounds/:id/ballot-pdf — Download the printable PDF
router.get('/rounds/:id/ballot-pdf', async (req, res) => {
  try {
    const roundId = parseInt(req.params.id);
    const outDir = await getOutputDir(roundId);
    if (!outDir) return res.status(404).json({ error: 'Round not found' });

    const pdfPath = path.join(outDir, 'ballots.pdf');
    if (!fs.existsSync(pdfPath)) {
      return res.status(404).json({ error: 'Ballots not yet generated' });
    }

    // Use round number and race name for a friendly filename
    const { rows: [round] } = await db.query('SELECT round_number, race_id FROM rounds WHERE id = $1', [roundId]);
    const { rows: [race] } = await db.query('SELECT name FROM races WHERE id = $1', [round.race_id]);
    const raceName = race.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    res.download(pdfPath, `ballots-${raceName}-round-${round.round_number}.pdf`);
  } catch (err) {
    console.error('Download ballot PDF error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/rounds/:id/ballot-data — Download the ZIP (metadata only)
router.get('/rounds/:id/ballot-data', async (req, res) => {
  try {
    const roundId = parseInt(req.params.id);
    const outDir = await getOutputDir(roundId);
    if (!outDir) return res.status(404).json({ error: 'Round not found' });

    const zipPath = path.join(outDir, 'ballot-data.zip');
    if (!fs.existsSync(zipPath)) {
      return res.status(404).json({ error: 'Ballot data not yet generated' });
    }

    const { rows: [round] } = await db.query('SELECT round_number, race_id FROM rounds WHERE id = $1', [roundId]);
    const { rows: [race] } = await db.query('SELECT name FROM races WHERE id = $1', [round.race_id]);
    const raceName = race.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    res.download(zipPath, `ballot-data-${raceName}-round-${round.round_number}.zip`);
  } catch (err) {
    console.error('Download ballot data error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/rounds/:id/ballot-preview — Preview ballot(s)
// Optional ?size=quarter_letter to preview a specific size with multi-up layout
router.get('/rounds/:id/ballot-preview', async (req, res) => {
  try {
    const roundId = parseInt(req.params.id);
    const requestedSize = req.query.size;

    // If a size is specified, generate a fresh preview with that size
    if (requestedSize && SIZES[requestedSize]) {
      const outDir = await getOutputDir(roundId);
      if (!outDir) return res.status(404).json({ error: 'Round not found' });

      // Use existing serials if available, otherwise use dummy SNs for design preview
      const { rows: existingSerials } = await db.query(
        'SELECT serial_number FROM ballot_serials WHERE round_id = $1 LIMIT $2',
        [roundId, SIZES[requestedSize].perPage]
      );

      const serialNumbers = existingSerials.length > 0
        ? existingSerials.map(s => s.serial_number)
        : Array.from({ length: SIZES[requestedSize].perPage }, (_, i) => `SAMPLE${String(i + 1).padStart(2, '0')}`);

      // Ensure output directory exists
      fs.mkdirSync(outDir, { recursive: true });

      const previewPath = path.join(outDir, `preview-${requestedSize}.pdf`);
      const { generatePreviewPdf } = require('../pdf/ballotGenerator');
      await generatePreviewPdf({
        roundId,
        sizeKey: requestedSize,
        serialNumbers,
        outputPath: previewPath,
      });

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline');
      fs.createReadStream(previewPath).pipe(res);
      return;
    }

    // Default: return the existing generated PDF
    const outDir = await getOutputDir(roundId);
    if (!outDir) return res.status(404).json({ error: 'Round not found' });

    const pdfPath = path.join(outDir, 'ballots.pdf');
    if (!fs.existsSync(pdfPath)) {
      return res.status(404).json({ error: 'Ballots not yet generated' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline');
    fs.createReadStream(pdfPath).pipe(res);
  } catch (err) {
    console.error('Ballot preview error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// GET /api/admin/rounds/:id/results-pdf — Download the results PDF
router.get('/rounds/:id/results-pdf', async (req, res) => {
  try {
    const { generateResultsPdf } = require('../pdf/resultsPdf');
    const pdfPath = await generateResultsPdf(parseInt(req.params.id));
    const { rows: [round] } = await db.query('SELECT round_number, race_id FROM rounds WHERE id = $1', [parseInt(req.params.id)]);
    const { rows: [race] } = await db.query('SELECT name FROM races WHERE id = $1', [round.race_id]);
    const raceName = race.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    res.download(pdfPath, `results-${raceName}-round-${round.round_number}.pdf`);
  } catch (err) {
    console.error('Results PDF error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// GET /api/admin/rounds/:id/calibration-pdf — Generate a calibration ballot showing OMR crop zones
router.get('/rounds/:id/calibration-pdf', async (req, res) => {
  try {
    const roundId = parseInt(req.params.id);
    const outDir = await getOutputDir(roundId);
    if (!outDir) return res.status(404).json({ error: 'Round not found' });

    const specPath = path.join(outDir, 'ballot-spec.json');
    if (!fs.existsSync(specPath)) {
      return res.status(404).json({ error: 'ballot-spec.json not found — generate ballots first' });
    }

    const { generateCalibrationPdf } = require('../pdf/ballotGenerator');
    const calibPath = path.join(outDir, 'calibration.pdf');
    await generateCalibrationPdf({ roundId, outputPath: calibPath });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline');
    fs.createReadStream(calibPath).pipe(res);
  } catch (err) {
    console.error('Calibration PDF error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// PUT /api/admin/ballot-serials/:id/reset — Reset a ballot serial status back to 'unused'
router.put('/ballot-serials/:id/reset', async (req, res) => {
  try {
    const { reset_by } = req.body;
    if (!reset_by) return res.status(400).json({ error: 'reset_by (your name) is required' });

    const { rows: [bs] } = await db.query('SELECT * FROM ballot_serials WHERE id = $1', [req.params.id]);
    if (!bs) return res.status(404).json({ error: 'Ballot serial not found' });

    const oldStatus = bs.status;
    await db.query("UPDATE ballot_serials SET status = 'unused' WHERE id = $1", [req.params.id]);

    console.log(`[BallotReset] ${bs.serial_number} reset from '${oldStatus}' to 'unused' by ${reset_by}`);
    res.json({ message: `Ballot ${bs.serial_number} reset from '${oldStatus}' to 'unused'`, serial_number: bs.serial_number });
  } catch (err) {
    console.error('Ballot reset error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/rounds/:id/reset-spoiled — Bulk reset all spoiled ballots in a round back to 'unused'
router.put('/rounds/:id/reset-spoiled', async (req, res) => {
  try {
    const { reset_by } = req.body;
    if (!reset_by) return res.status(400).json({ error: 'reset_by (your name) is required' });

    const roundId = parseInt(req.params.id);
    const { rows } = await db.query(
      "SELECT id, serial_number FROM ballot_serials WHERE round_id = $1 AND status = 'spoiled'",
      [roundId]
    );

    if (rows.length === 0) {
      return res.json({ message: 'No spoiled ballots found in this round', count: 0 });
    }

    const ids = rows.map(r => r.id);
    await db.query(
      "UPDATE ballot_serials SET status = 'unused' WHERE id = ANY($1::int[])",
      [ids]
    );

    console.log(`[BallotReset] Reset ${rows.length} spoiled ballots in round ${roundId} to 'unused' by ${reset_by}`);
    res.json({
      message: `Reset ${rows.length} spoiled ballots to 'unused'`,
      count: rows.length,
      serials: rows.map(r => r.serial_number),
    });
  } catch (err) {
    console.error('Bulk ballot reset error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
