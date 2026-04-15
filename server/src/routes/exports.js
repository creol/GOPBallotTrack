const { Router } = require('express');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const db = require('../db');
const { exportImages, exportFull, getExportStatus } = require('../services/exportService');
const { generateEventSummaryPdf, generateEventDetailPdf } = require('../pdf/eventResultsPdf');
const { generateResultsPdf } = require('../pdf/resultsPdf');

const router = Router();

// POST /api/admin/elections/:id/export-images — Start image export
router.post('/elections/:id/export-images', async (req, res) => {
  try {
    const electionId = parseInt(req.params.id);
    // Start async — don't await, return immediately
    exportImages(electionId).catch(err => console.error('Image export error:', err));
    res.json({ message: 'Image export started', status_url: `/api/admin/elections/${electionId}/export-images/status` });
  } catch (err) {
    console.error('Start image export error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/elections/:id/export-images/status — Check export status
router.get('/elections/:id/export-images/status', (req, res) => {
  const status = getExportStatus(`images-${req.params.id}`);
  res.json(status);
});

// GET /api/admin/elections/:id/export-images/download — Download the ZIP
router.get('/elections/:id/export-images/download', (req, res) => {
  const status = getExportStatus(`images-${req.params.id}`);
  if (status.status !== 'ready' || !status.path || !fs.existsSync(status.path)) {
    return res.status(404).json({ error: 'Export not ready' });
  }
  res.download(status.path, `ballot-images-election-${req.params.id}.zip`);
});

// POST /api/admin/elections/:id/export-full — Start full export
router.post('/elections/:id/export-full', async (req, res) => {
  try {
    const electionId = parseInt(req.params.id);
    exportFull(electionId).catch(err => console.error('Full export error:', err));
    res.json({ message: 'Full export started', status_url: `/api/admin/elections/${electionId}/export-full/status` });
  } catch (err) {
    console.error('Start full export error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/elections/:id/export-full/status
router.get('/elections/:id/export-full/status', (req, res) => {
  const status = getExportStatus(`full-${req.params.id}`);
  res.json(status);
});

// GET /api/admin/elections/:id/export-full/download
router.get('/elections/:id/export-full/download', (req, res) => {
  const status = getExportStatus(`full-${req.params.id}`);
  if (status.status !== 'ready' || !status.path || !fs.existsSync(status.path)) {
    return res.status(404).json({ error: 'Export not ready' });
  }
  res.download(status.path, `full-export-election-${req.params.id}.zip`);
});

// GET /api/admin/elections/:id/results-summary-pdf — Event Results Summary PDF
router.get('/elections/:id/results-summary-pdf', async (req, res) => {
  try {
    const electionId = parseInt(req.params.id);
    const pdfPath = await generateEventSummaryPdf(electionId);
    const { rows: [election] } = await db.query('SELECT name FROM elections WHERE id = $1', [electionId]);
    const name = (election?.name || 'election').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    res.download(pdfPath, `results-summary-${name}.pdf`);
  } catch (err) {
    console.error('Event summary PDF error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// GET /api/admin/elections/:id/results-detail-pdf — Event Results Detail PDF
router.get('/elections/:id/results-detail-pdf', async (req, res) => {
  try {
    const electionId = parseInt(req.params.id);
    const pdfPath = await generateEventDetailPdf(electionId);
    const { rows: [election] } = await db.query('SELECT name FROM elections WHERE id = $1', [electionId]);
    const name = (election?.name || 'election').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    res.download(pdfPath, `results-detail-${name}.pdf`);
  } catch (err) {
    console.error('Event detail PDF error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// GET /api/admin/elections/:id/results-zip — ZIP of all results PDFs (summary + detail + per-round)
router.get('/elections/:id/results-zip', async (req, res) => {
  try {
    const electionId = parseInt(req.params.id);
    const { rows: [election] } = await db.query('SELECT name FROM elections WHERE id = $1', [electionId]);
    if (!election) return res.status(404).json({ error: 'Election not found' });

    const electionName = (election.name || 'election').toLowerCase().replace(/[^a-z0-9]+/g, '-');

    // Generate summary and detail PDFs
    const summaryPath = await generateEventSummaryPdf(electionId);
    const detailPath = await generateEventDetailPdf(electionId);

    // Generate per-round PDFs for all finalized rounds
    const { rows: races } = await db.query(
      'SELECT * FROM races WHERE election_id = $1 ORDER BY display_order', [electionId]
    );

    const roundPdfs = [];
    for (const race of races) {
      const { rows: rounds } = await db.query(
        "SELECT * FROM rounds WHERE race_id = $1 AND status = 'round_finalized' ORDER BY round_number",
        [race.id]
      );
      for (const round of rounds) {
        try {
          const pdfPath = await generateResultsPdf(round.id);
          const raceName = race.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
          roundPdfs.push({
            path: pdfPath,
            name: `per-round/${raceName}-round-${round.round_number}-results.pdf`,
          });
        } catch {}
      }
    }

    // Build ZIP
    const archive = archiver('zip', { zlib: { level: 6 } });
    res.attachment(`results-all-${electionName}.zip`);
    archive.pipe(res);

    archive.file(summaryPath, { name: 'event-results-summary.pdf' });
    archive.file(detailPath, { name: 'event-results-detail.pdf' });
    for (const rp of roundPdfs) {
      archive.file(rp.path, { name: rp.name });
    }

    await archive.finalize();
  } catch (err) {
    console.error('Results ZIP error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || 'Internal server error' });
    }
  }
});

module.exports = router;
