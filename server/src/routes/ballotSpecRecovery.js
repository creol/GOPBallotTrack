/**
 * Admin API for in-place ballot-spec recovery from a printed PDF.
 *
 * Used when the on-disk ballot-spec.json no longer matches the printed paper
 * (e.g. ballots were regenerated after printing). The admin uploads the PDF
 * that was actually sent to the printer, the server extracts QR + oval positions
 * directly from the PDF's drawing operators (no rendering / no manual entry),
 * matches names to DB candidates, and rewrites ballot-spec.json for every round
 * in the race.
 *
 * Two endpoints, both multipart/form-data:
 *
 *   POST /api/admin/races/:id/recover-spec/preview
 *     - Extracts the spec and matches against DB candidates, but writes nothing.
 *     - Returns full preview so the UI can show what would change.
 *
 *   POST /api/admin/races/:id/recover-spec/apply
 *     - Extracts + applies. Saves the source PDF to
 *       uploads/elections/{eid}/recovery-source-pdfs/race-{rid}-{ts}.pdf
 *       for audit trail. Backs up each round's existing ballot-spec.json to
 *       ballot-spec.broken-{ts}.json before overwriting.
 *
 * Multer is configured for in-memory upload (PDFs are typically a few MB; the
 * largest in the recent recovery was 2.9 MB). 50 MB cap is plenty.
 */

const { Router } = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { extractDraftSpecFromPdf, applyDraftSpecToRace } = require('../services/ballotSpecRecovery');

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const UPLOADS_ROOT = path.join(__dirname, '..', '..', '..', 'uploads');

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function parseCandidatesOverride(value) {
  if (!value) return undefined;
  return String(value).split('|').map(s => s.trim()).filter(Boolean);
}

/**
 * POST /api/admin/races/:id/recover-spec/preview
 *
 * Multipart fields:
 *   file:                 required, the PDF
 *   ballot_size:          optional, force a size key
 *   candidates_override:  optional, "name1|name2|..."
 */
router.post('/races/:id/recover-spec/preview', upload.single('file'), async (req, res) => {
  try {
    const raceId = parseInt(req.params.id, 10);
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'PDF file is required (multipart field "file")' });
    }
    if (!raceId) return res.status(400).json({ error: 'Invalid race id' });

    const candidatesOverride = parseCandidatesOverride(req.body?.candidates_override);
    const ballotSize = req.body?.ballot_size || undefined;

    let extraction;
    try {
      extraction = await extractDraftSpecFromPdf({
        pdfBuffer: req.file.buffer,
        sourceName: req.file.originalname || 'uploaded.pdf',
        ballotSize,
        candidatesOverride,
      });
    } catch (e) {
      return res.status(400).json({ error: 'Extraction failed: ' + e.message });
    }

    // Dry-run apply to compute candidate matches + rounds list
    const apply = await applyDraftSpecToRace({
      draftSpec: extraction.draftSpec,
      raceId,
      db,
      dryRun: true,
    });

    return res.json({
      ok: apply.ok,
      error: apply.error || null,
      pdf: {
        name: req.file.originalname || null,
        size_bytes: req.file.size || (req.file.buffer ? req.file.buffer.length : 0),
      },
      extraction: extraction.info,
      draft_spec: extraction.draftSpec,
      ...apply,
    });
  } catch (err) {
    console.error('Recover-spec preview error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

/**
 * POST /api/admin/races/:id/recover-spec/apply
 *
 * Multipart fields:
 *   file:                 required, the PDF
 *   ballot_size:          optional
 *   candidates_override:  optional, "name1|name2|..."
 *   confirm:              required, must be "true" — guard against accidental writes
 */
router.post('/races/:id/recover-spec/apply', upload.single('file'), async (req, res) => {
  try {
    const raceId = parseInt(req.params.id, 10);
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'PDF file is required (multipart field "file")' });
    }
    if (!raceId) return res.status(400).json({ error: 'Invalid race id' });
    if (req.body?.confirm !== 'true') {
      return res.status(400).json({ error: 'Apply requires confirm=true (POST a confirmation form field)' });
    }

    const candidatesOverride = parseCandidatesOverride(req.body?.candidates_override);
    const ballotSize = req.body?.ballot_size || undefined;

    let extraction;
    try {
      extraction = await extractDraftSpecFromPdf({
        pdfBuffer: req.file.buffer,
        sourceName: req.file.originalname || 'uploaded.pdf',
        ballotSize,
        candidatesOverride,
      });
    } catch (e) {
      return res.status(400).json({ error: 'Extraction failed: ' + e.message });
    }

    // Look up race for election id (to know where to save the source PDF)
    const { rows: raceRows } = await db.query('SELECT id, election_id FROM races WHERE id = $1', [raceId]);
    if (raceRows.length === 0) return res.status(404).json({ error: `Race ${raceId} not found` });
    const electionId = raceRows[0].election_id;

    // Save the source PDF for audit (don't fail apply if save fails — log and continue)
    let savedPdfPath = null;
    try {
      const recoveryDir = path.join(UPLOADS_ROOT, 'elections', String(electionId), 'recovery-source-pdfs');
      fs.mkdirSync(recoveryDir, { recursive: true });
      const outName = `race-${raceId}-${timestamp()}.pdf`;
      savedPdfPath = path.join(recoveryDir, outName);
      fs.writeFileSync(savedPdfPath, req.file.buffer);
    } catch (e) {
      console.warn('Could not save recovery source PDF for audit:', e.message);
      savedPdfPath = null;
    }

    const apply = await applyDraftSpecToRace({
      draftSpec: extraction.draftSpec,
      raceId,
      db,
      dryRun: false,
    });

    if (!apply.ok) {
      // We saved the PDF for audit; if apply failed mid-stream that's safe because
      // applyDraftSpecToRace doesn't write spec files unless candidate matching
      // fully succeeds.
      return res.status(400).json({
        ok: false,
        error: apply.error || 'Apply failed',
        candidate_matches: apply.candidate_matches || [],
        unmatched_pdf_names: apply.unmatched_pdf_names || [],
        missing_from_pdf: apply.missing_from_pdf || [],
        saved_source_pdf: savedPdfPath ? path.relative(path.join(UPLOADS_ROOT, '..'), savedPdfPath).replace(/\\/g, '/') : null,
      });
    }

    return res.json({
      ok: true,
      pdf: {
        name: req.file.originalname || null,
        size_bytes: req.file.size || (req.file.buffer ? req.file.buffer.length : 0),
      },
      saved_source_pdf: savedPdfPath ? path.relative(path.join(UPLOADS_ROOT, '..'), savedPdfPath).replace(/\\/g, '/') : null,
      extraction: extraction.info,
      ...apply,
    });
  } catch (err) {
    console.error('Recover-spec apply error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

module.exports = router;
