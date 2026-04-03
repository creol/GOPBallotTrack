const { Router } = require('express');
const fs = require('fs');
const { exportImages, exportFull, getExportStatus } = require('../services/exportService');

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

module.exports = router;
