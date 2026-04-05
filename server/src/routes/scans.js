const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { recordScan } = require('../services/scannerService');

const router = Router();

// Dynamic multer storage — save to uploads/elections/{eid}/rounds/{rid}/scans/
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      // Get round info from pass
      const { rows: [pass] } = await db.query('SELECT * FROM passes WHERE id = $1', [req.params.id]);
      if (!pass) return cb(new Error('Pass not found'));

      const { rows: [round] } = await db.query('SELECT * FROM rounds WHERE id = $1', [pass.round_id]);
      const { rows: [race] } = await db.query('SELECT * FROM races WHERE id = $1', [round.race_id]);

      const dir = path.join(__dirname, '..', '..', '..', 'uploads', 'elections', String(race.election_id), 'rounds', String(round.id), 'scans');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const ts = Date.now();
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `${file.fieldname}-${ts}${ext}`);
  },
});

const upload = multer({ storage });
const scanUpload = upload.fields([
  { name: 'front_image', maxCount: 1 },
  { name: 'back_image', maxCount: 1 },
]);

// POST /api/passes/:id/scans — Record a scan (QR-based)
router.post('/passes/:id/scans', scanUpload, async (req, res) => {
  try {
    const passId = parseInt(req.params.id);
    const { serial_number, candidate_id, ballot_box_id, scanned_by } = req.body;

    if (!serial_number || !candidate_id) {
      return res.status(400).json({ error: 'serial_number and candidate_id are required' });
    }

    const frontImagePath = req.files?.front_image?.[0]?.path || null;
    const backImagePath = req.files?.back_image?.[0]?.path || null;

    const result = await recordScan({
      passId,
      serialNumber: serial_number,
      candidateId: parseInt(candidate_id),
      ballotBoxId: ballot_box_id ? parseInt(ballot_box_id) : null,
      scannedBy: scanned_by || null,
      frontImagePath,
      backImagePath,
    });

    // Broadcast scan:recorded via WebSocket
    const io = req.app.get('io');
    if (io) io.emit('scan:recorded', { pass_id: passId, count: result.count });

    res.status(201).json({ scan: result.scan, count: result.count });
  } catch (err) {
    console.error('Record scan error:', err);
    const status = err.message.includes('not found') || err.message.includes('already been') || err.message.includes('spoiled') ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// POST /api/passes/:id/scans/manual — Manual SN entry (same logic, different source)
router.post('/passes/:id/scans/manual', scanUpload, async (req, res) => {
  try {
    const passId = parseInt(req.params.id);
    const { serial_number, candidate_id, ballot_box_id, scanned_by } = req.body;

    if (!serial_number || !candidate_id) {
      return res.status(400).json({ error: 'serial_number and candidate_id are required' });
    }

    const frontImagePath = req.files?.front_image?.[0]?.path || null;
    const backImagePath = req.files?.back_image?.[0]?.path || null;

    const result = await recordScan({
      passId,
      serialNumber: serial_number,
      candidateId: parseInt(candidate_id),
      ballotBoxId: ballot_box_id ? parseInt(ballot_box_id) : null,
      scannedBy: scanned_by || 'manual',
      frontImagePath,
      backImagePath,
    });

    const io = req.app.get('io');
    if (io) io.emit('scan:recorded', { pass_id: passId, count: result.count });

    res.status(201).json({ scan: result.scan, count: result.count });
  } catch (err) {
    console.error('Manual scan error:', err);
    const status = err.message.includes('not found') || err.message.includes('already been') || err.message.includes('spoiled') ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

module.exports = router;
