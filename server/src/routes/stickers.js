// stickers.js — QR voter-token sticker batch generation (Prompt H, stage H2).
//
// Mounted at /api/admin behind requireAuth.

const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { generateTokenBatch } = require('../services/voterTokenService');
const { generateStickerPdf, LABEL_PRESETS, PAGE_SIZES } = require('../pdf/stickerGenerator');
const { generateUniqueEventCode } = require('../services/eventCode');
const { logFromRequest } = require('../services/auditLog');

const router = Router();

const VOTE_BASE_URL = (process.env.VOTE_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

function batchDir(electionId) {
  return path.join(__dirname, '..', '..', '..', 'uploads', 'elections', String(electionId), 'sticker-batches');
}
function batchPdfPath(electionId, batchId) {
  return path.join(batchDir(electionId), `${batchId}.pdf`);
}

/** Make a filesystem-safe fragment for download filenames. */
function safeName(s) {
  return String(s || '').trim().replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'batch';
}

/** Load an election, ensuring it has an event_code (defensive backfill). */
async function loadElection(id) {
  const { rows: [election] } = await db.query(
    'SELECT id, name, event_code FROM elections WHERE id = $1', [id]
  );
  if (!election) return null;
  if (!election.event_code) {
    election.event_code = await generateUniqueEventCode();
    await db.query('UPDATE elections SET event_code = $1 WHERE id = $2', [election.event_code, id]);
  }
  return election;
}

// GET /api/admin/elections/:id/sticker-batches — list batches for an event
router.get('/elections/:id/sticker-batches', async (req, res) => {
  try {
    const electionId = parseInt(req.params.id, 10);
    const { rows } = await db.query(
      `SELECT id, event_id, batch_name, count, size_preset, generated_at, generated_by, notes
       FROM sticker_batches WHERE event_id = $1 ORDER BY generated_at DESC, id DESC`,
      [electionId]
    );
    const batches = rows.map((b) => ({
      ...b,
      pdf_available: fs.existsSync(batchPdfPath(electionId, b.id)),
    }));
    res.json(batches);
  } catch (err) {
    console.error('List sticker batches error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/elections/:id/sticker-batches — generate a new batch
router.post('/elections/:id/sticker-batches', async (req, res) => {
  try {
    const electionId = parseInt(req.params.id, 10);
    const {
      count, sizePreset, customWidth, customHeight,
      pageSize, errorCorrection, batchName, notes,
    } = req.body || {};

    // --- validation ---
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > 50000) {
      return res.status(400).json({ error: 'count must be a whole number between 1 and 50000' });
    }
    if (!LABEL_PRESETS[sizePreset]) {
      return res.status(400).json({ error: `Unknown sticker size preset: ${sizePreset}` });
    }
    if (sizePreset === 'custom') {
      const cw = Number(customWidth), ch = Number(customHeight);
      if (!(cw > 0) || !(ch > 0) || cw > 8 || ch > 11) {
        return res.status(400).json({ error: 'Custom width/height must be positive and within an 8" × 11" page' });
      }
    }
    const page = (pageSize === 'a4') ? 'a4' : 'letter';
    const ecl = (errorCorrection === 'H') ? 'H' : 'M';

    const election = await loadElection(electionId);
    if (!election) return res.status(404).json({ error: 'Election not found' });

    // --- generate + persist tokens (transactional), then render the PDF ---
    const { batchId, tokens } = await generateTokenBatch({
      eventId: electionId,
      count: n,
      batch: {
        batchName: batchName || null,
        sizePreset,
        generatedBy: req.session?.name || null,
        notes: notes || null,
      },
    });

    fs.mkdirSync(batchDir(electionId), { recursive: true });
    const pdfPath = batchPdfPath(electionId, batchId);
    await generateStickerPdf({
      outputPath: pdfPath,
      tokens,
      sizePreset,
      customWidth: sizePreset === 'custom' ? Number(customWidth) : undefined,
      customHeight: sizePreset === 'custom' ? Number(customHeight) : undefined,
      pageSize: page,
      errorCorrection: ecl,
      eventName: election.name,
      eventCode: election.event_code,
      baseUrl: VOTE_BASE_URL,
    });

    await logFromRequest(req, 'sticker_batch.generate', {
      targetType: 'sticker_batch',
      targetId: batchId,
      details: { election_id: electionId, count: n, size_preset: sizePreset, batch_name: batchName || null },
    });

    const { rows: [batch] } = await db.query(
      `SELECT id, event_id, batch_name, count, size_preset, generated_at, generated_by, notes
       FROM sticker_batches WHERE id = $1`, [batchId]
    );
    res.status(201).json({ ...batch, pdf_available: true });
  } catch (err) {
    console.error('Generate sticker batch error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// GET /api/admin/sticker-batches/:batchId/pdf — download a batch's sticker sheet
router.get('/sticker-batches/:batchId/pdf', async (req, res) => {
  try {
    const batchId = parseInt(req.params.batchId, 10);
    const { rows: [batch] } = await db.query(
      `SELECT b.id, b.event_id, b.batch_name, b.count, e.name AS event_name
       FROM sticker_batches b JOIN elections e ON e.id = b.event_id
       WHERE b.id = $1`, [batchId]
    );
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    const pdfPath = batchPdfPath(batch.event_id, batchId);
    if (!fs.existsSync(pdfPath)) {
      return res.status(404).json({ error: 'PDF for this batch is not available' });
    }

    const filename = `${safeName(batch.event_name)}_stickers_${safeName(batch.batch_name || 'batch')}_${batch.count}.pdf`;
    res.download(pdfPath, filename);
  } catch (err) {
    console.error('Download sticker PDF error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
