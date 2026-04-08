const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const archiver = require('archiver');
const db = require('../db');
const { processBallot } = require('../services/scanProcessingService');

const { APP_VERSION } = require('../version');

const router = Router();

// In-memory station assignments (reset on server restart)
const stationAssignments = new Map();

// Multer for image uploads
const upload = multer({
  dest: path.join(__dirname, '..', '..', '..', 'uploads', 'station-uploads'),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// GET /api/stations/download-agent — Download station agent as ZIP (includes node_modules)
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

  // Include node_modules if they exist (so stations don't need npm)
  const nodeModulesDir = path.join(agentDir, 'node_modules');
  if (fs.existsSync(nodeModulesDir)) {
    archive.directory(nodeModulesDir, 'node_modules');
  }

  // Generate a pre-filled config.json with this server's URL and the station ID
  const config = JSON.stringify({
    serverUrl,
    stationId,
    watchFolder: 'C:\\ScanSnap\\Output',
    retryAttempts: 5,
  }, null, 2);
  archive.append(config, { name: 'config.json' });

  archive.finalize();
});

// GET /api/stations/download-installer — Download a self-configuring .bat installer
router.get('/stations/download-installer', (req, res) => {
  const stationId = req.query.stationId || 'station-1';
  const serverUrl = `${req.protocol}://${req.get('host')}`;

  const templatePath = path.join(__dirname, '..', '..', '..', 'station-install.bat');
  if (!fs.existsSync(templatePath)) {
    return res.status(404).json({ error: 'station-install.bat template not found on server' });
  }

  let bat = fs.readFileSync(templatePath, 'utf8');
  bat = bat.replace('__SERVER_URL__', serverUrl);
  bat = bat.replace('__STATION_ID__', stationId);

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="BallotTrack-Station-Setup.bat"`);
  res.send(bat);
});

// GET /api/stations/download-node — Serve Windows x64 node.exe for station laptops
router.get('/stations/download-node', (req, res) => {
  // Serve the Windows binary downloaded during Docker build (NOT the container's Linux binary)
  const nodePath = path.join(__dirname, '..', '..', '..', 'node-win.exe');
  if (!fs.existsSync(nodePath)) {
    return res.status(404).json({ error: 'Windows node.exe not found — rebuild the Docker image' });
  }
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', 'attachment; filename="node.exe"');
  res.sendFile(path.resolve(nodePath));
});

// GET /api/stations/download-bundle — Single ZIP with node.exe + agent + node_modules + config
router.get('/stations/download-bundle', (req, res) => {
  const stationId = req.query.stationId || 'station-1';
  const serverUrl = `${req.protocol}://${req.get('host')}`;
  const agentDir = path.join(__dirname, '..', '..', '..', 'agent');
  const nodeWinPath = path.join(__dirname, '..', '..', '..', 'node-win.exe');

  if (!fs.existsSync(path.join(agentDir, 'station-agent.js'))) {
    return res.status(404).json({ error: 'Agent files not found on server' });
  }
  if (!fs.existsSync(nodeWinPath)) {
    return res.status(404).json({ error: 'Windows node.exe not found — rebuild the Docker image' });
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="ballottrack-station-${stationId}.zip"`);

  const archive = archiver('zip', { zlib: { level: 1 } }); // level 1 = fast compression
  archive.pipe(res);

  // Windows node.exe (~40 MB — doesn't compress much, so speed > ratio)
  archive.file(nodeWinPath, { name: 'node.exe' });

  // Agent source files
  archive.file(path.join(agentDir, 'station-agent.js'), { name: 'station-agent.js' });
  archive.file(path.join(agentDir, 'setup.js'), { name: 'setup.js' });
  archive.file(path.join(agentDir, 'package.json'), { name: 'package.json' });
  archive.file(path.join(agentDir, 'README.md'), { name: 'README.md' });

  // Pre-installed node_modules
  const nodeModulesDir = path.join(agentDir, 'node_modules');
  if (fs.existsSync(nodeModulesDir)) {
    archive.directory(nodeModulesDir, 'node_modules');
  }

  // Pre-filled config.json
  const config = JSON.stringify({
    serverUrl,
    stationId,
    watchFolder: 'C:\\ScanSnap\\Output',
    retryAttempts: 5,
  }, null, 2);
  archive.append(config, { name: 'config.json' });

  archive.finalize();
});

// GET /api/stations/agent-version — Current agent version (for auto-update check)
router.get('/stations/agent-version', (req, res) => {
  res.json({ version: APP_VERSION });
});

// GET /api/stations/agent-source — Download latest station-agent.js source
router.get('/stations/agent-source', (req, res) => {
  const agentPath = path.join(__dirname, '..', '..', '..', 'agent', 'station-agent.js');
  if (!fs.existsSync(agentPath)) {
    return res.status(404).json({ error: 'Agent source not found' });
  }
  res.setHeader('Content-Type', 'text/plain');
  res.sendFile(path.resolve(agentPath));
});

// GET /api/stations/active-rounds — All rounds available for station assignment
router.get('/stations/active-rounds', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT r.id as round_id, r.round_number, r.paper_color, r.status,
              ra.id as race_id, ra.name as race_name,
              e.id as election_id, e.name as election_name
       FROM rounds r
       JOIN races ra ON r.race_id = ra.id
       JOIN elections e ON ra.election_id = e.id
       WHERE r.status IN ('voting_open', 'voting_closed', 'tallying')
         AND e.status = 'active'
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
