const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const archiver = require('archiver');
const db = require('../db');
const { processBallot } = require('../services/scanProcessingService');

const router = Router();

// In-memory station assignments (reset on server restart)
const stationAssignments = new Map();

// Multer for image uploads
const upload = multer({
  dest: path.join(__dirname, '..', '..', '..', 'uploads', 'station-uploads'),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// GET /api/stations/download-agent — Download station agent as ZIP
router.get('/stations/download-agent', (req, res) => {
  const stationId = req.query.stationId || 'station-1';
  const serverUrl = `${req.protocol}://${req.get('host')}`;

  const agentDir = path.join(__dirname, '..', '..', '..', 'agent');

  // Check if agent files exist
  if (!fs.existsSync(path.join(agentDir, 'station-agent.js'))) {
    return res.status(404).json({ error: 'Agent files not found on server' });
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="ballottrack-agent-${stationId}.zip"`);

  const archive = archiver('zip', { zlib: { level: 5 } });
  archive.pipe(res);

  // Add agent files
  archive.file(path.join(agentDir, 'station-agent.js'), { name: 'station-agent.js' });
  archive.file(path.join(agentDir, 'setup.js'), { name: 'setup.js' });
  archive.file(path.join(agentDir, 'package.json'), { name: 'package.json' });
  archive.file(path.join(agentDir, 'README.md'), { name: 'README.md' });

  // Generate a pre-filled config.json with this server's URL and the station ID
  const config = JSON.stringify({
    serverUrl,
    stationId,
    watchFolder: process.platform === 'win32' ? 'C:\\ScanSnap\\Output' : `${require('os').homedir()}/ScanSnap/Output`,
    retryAttempts: 5,
  }, null, 2);
  archive.append(config, { name: 'config.json' });

  archive.finalize();
});

// GET /api/stations/active-rounds — All rounds in tallying status
router.get('/stations/active-rounds', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT r.id as round_id, r.round_number, r.paper_color, r.status,
              ra.id as race_id, ra.name as race_name,
              e.id as election_id, e.name as election_name
       FROM rounds r
       JOIN races ra ON r.race_id = ra.id
       JOIN elections e ON ra.election_id = e.id
       WHERE r.status = 'tallying'
       ORDER BY e.name, ra.display_order, r.round_number`
    );
    res.json(rows);
  } catch (err) {
    console.error('Active rounds error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/stations/:stationId/assign — Assign station to a round
router.post('/stations/:stationId/assign', (req, res) => {
  const { roundId } = req.body;
  if (!roundId) return res.status(400).json({ error: 'roundId is required' });

  stationAssignments.set(req.params.stationId, {
    roundId: parseInt(roundId),
    assignedAt: new Date().toISOString(),
  });

  console.log(`[Stations] ${req.params.stationId} assigned to round ${roundId}`);
  res.json({ success: true, stationId: req.params.stationId, roundId: parseInt(roundId) });
});

// GET /api/stations/:stationId/assignment — Get current assignment
router.get('/stations/:stationId/assignment', (req, res) => {
  const assignment = stationAssignments.get(req.params.stationId);
  if (!assignment) return res.json({ assigned: false });
  res.json({ assigned: true, ...assignment });
});

// POST /api/stations/:stationId/upload — Upload ballot image from station agent
router.post('/stations/:stationId/upload', upload.single('image'), async (req, res) => {
  try {
    const stationId = req.params.stationId;
    const assignment = stationAssignments.get(stationId);

    if (!assignment) {
      return res.status(400).json({ error: 'Station not assigned to a round. Use /station-setup to assign.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    // Read the uploaded file
    const imageBuffer = fs.readFileSync(req.file.path);

    // Process the ballot
    const io = req.app.get('io');
    const result = await processBallot({
      imageBuffer,
      stationId,
      roundId: assignment.roundId,
      io,
    });

    // Clean up temp upload
    try { fs.unlinkSync(req.file.path); } catch {}

    if (result.success) {
      res.json(result);
    } else {
      res.status(result.type === 'wrong_station' ? 409 : 400).json(result);
    }
  } catch (err) {
    console.error('Station upload error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

module.exports = router;
