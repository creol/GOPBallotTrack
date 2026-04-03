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

    const outDir = await getOutputDir(roundId);
    const pdfExists = outDir && fs.existsSync(path.join(outDir, 'ballots.pdf'));

    res.json({
      has_serials: serialCount > 0,
      serial_count: serialCount,
      pdf_exists: !!pdfExists,
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

    // Check if SNs already exist (pre-generated at race creation)
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

    // Check if ballots already exist for this round
    const { rows: [{ count }] } = await db.query(
      'SELECT COUNT(*) as count FROM ballot_serials WHERE round_id = $1', [roundId]
    );
    if (parseInt(count) > 0 && !confirmRegenerate) {
      return res.status(409).json({
        error: 'Ballots already generated for this round',
        existing_count: parseInt(count),
        message: 'Generating again will create NEW serial numbers and overwrite the existing PDF. If ballots have already been printed, do NOT regenerate. Send confirm_regenerate=true to proceed anyway.',
      });
    }

    // If regenerating, clear old serials first
    if (parseInt(count) > 0 && confirmRegenerate) {
      await db.query("DELETE FROM ballot_serials WHERE round_id = $1 AND status = 'unused'", [roundId]);
    }

    const result = await generateBallots({ roundId, quantity, sizeKey, logoPath });

    res.json({
      message: `Generated ${quantity} ballots`,
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
    const outDir = await getOutputDir(parseInt(req.params.id));
    if (!outDir) return res.status(404).json({ error: 'Round not found' });

    const pdfPath = path.join(outDir, 'ballots.pdf');
    if (!fs.existsSync(pdfPath)) {
      return res.status(404).json({ error: 'Ballots not yet generated' });
    }

    res.download(pdfPath, `ballots-round-${req.params.id}.pdf`);
  } catch (err) {
    console.error('Download ballot PDF error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/rounds/:id/ballot-data — Download the ZIP (metadata only)
router.get('/rounds/:id/ballot-data', async (req, res) => {
  try {
    const outDir = await getOutputDir(parseInt(req.params.id));
    if (!outDir) return res.status(404).json({ error: 'Round not found' });

    const zipPath = path.join(outDir, 'ballot-data.zip');
    if (!fs.existsSync(zipPath)) {
      return res.status(404).json({ error: 'Ballot data not yet generated' });
    }

    res.download(zipPath, `ballot-data-round-${req.params.id}.zip`);
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
    res.download(pdfPath, `results-round-${req.params.id}.pdf`);
  } catch (err) {
    console.error('Results PDF error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

module.exports = router;
