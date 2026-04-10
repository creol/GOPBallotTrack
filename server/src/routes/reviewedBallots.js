const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const { verifyPin } = require('../middleware/auth');

const router = Router();

// In-memory token store for mobile photo uploads (token → { reviewId, expiresAt })
const photoTokens = new Map();

// Multer for photo uploads
const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', '..', '..', 'uploads', 'reviewed-ballots');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `review-${Date.now()}${path.extname(file.originalname) || '.jpg'}`);
  },
});
const upload = multer({ storage: photoStorage });

// POST /api/rounds/:id/reviewed-ballots — Create a review record
router.post('/rounds/:id/reviewed-ballots', upload.single('photo'), async (req, res) => {
  try {
    const roundId = parseInt(req.params.id);
    const { serial_number, flag_reason, notes, reviewed_by, outcome, candidate_id } = req.body;

    if (!serial_number) return res.status(400).json({ error: 'serial_number is required' });

    // Find the ballot serial
    const { rows: [bs] } = await db.query(
      'SELECT * FROM ballot_serials WHERE serial_number = $1 AND round_id = $2',
      [serial_number.toUpperCase(), roundId]
    );
    if (!bs) return res.status(404).json({ error: 'Serial number not found for this round' });

    const photoPath = req.file?.path || null;

    const { rows: [review] } = await db.query(
      `INSERT INTO reviewed_ballots (round_id, original_serial_id, flag_reason, notes, photo_path, reviewed_by, outcome)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [roundId, bs.id, flag_reason || null, notes || null, photoPath, reviewed_by || null, outcome || null]
    );

    // If outcome is already set, apply it
    if (outcome) {
      await applyOutcome(review.id, outcome, candidate_id, null, reviewed_by);
    }

    const io = req.app.get('io');
    if (io) io.emit('scan:review_needed', { id: review.id, serial_number: bs.serial_number, round_id: roundId });

    res.status(201).json({ ...review, serial_number: bs.serial_number });
  } catch (err) {
    console.error('Create reviewed ballot error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/rounds/:id/reviewed-ballots — List reviewed ballots for a round
router.get('/rounds/:id/reviewed-ballots', async (req, res) => {
  try {
    const roundId = parseInt(req.params.id);
    const unresolvedOnly = req.query.status === 'unresolved';

    const whereClause = unresolvedOnly
      ? 'WHERE rb.round_id = $1 AND rb.outcome IS NULL'
      : 'WHERE rb.round_id = $1';

    const { rows } = await db.query(
      `SELECT rb.*, bs.serial_number,
              rbs.serial_number as replacement_serial_number
       FROM reviewed_ballots rb
       JOIN ballot_serials bs ON bs.id = rb.original_serial_id
       LEFT JOIN ballot_serials rbs ON rbs.id = rb.replacement_serial_id
       ${whereClause}
       ORDER BY rb.created_at DESC`,
      [roundId]
    );
    res.json(rows);
  } catch (err) {
    console.error('List reviewed ballots error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/reviewed-ballots/:id — Update outcome, notes, photo
router.put('/reviewed-ballots/:id', upload.single('photo'), async (req, res) => {
  try {
    const { outcome, notes, replacement_serial_id, candidate_id, reviewed_by } = req.body;

    const { rows: [existing] } = await db.query(
      'SELECT * FROM reviewed_ballots WHERE id = $1', [req.params.id]
    );
    if (!existing) return res.status(404).json({ error: 'Review record not found' });

    if (outcome && !['remade', 'spoiled', 'counted', 'rejected'].includes(outcome)) {
      return res.status(400).json({ error: 'outcome must be remade, spoiled, counted, or rejected' });
    }

    if (outcome === 'counted' && !candidate_id) {
      return res.status(400).json({ error: 'candidate_id is required when outcome is counted' });
    }

    // Wrong-round ballots require admin PIN to count
    if (outcome === 'counted' && existing.flag_reason === 'wrong_round') {
      const { pin, admin_user_id } = req.body;
      if (!pin || !admin_user_id) {
        return res.status(400).json({ error: 'Admin PIN verification is required to count a wrong-round ballot. Provide admin_user_id and pin.' });
      }
      const pinValid = await verifyPin(admin_user_id, pin);
      if (!pinValid) {
        return res.status(403).json({ error: 'Invalid admin PIN' });
      }
    }

    if (outcome === 'remade' && !replacement_serial_id) {
      return res.status(400).json({ error: 'replacement_serial_id is required when outcome is remade' });
    }

    const photoPath = req.file?.path || existing.photo_path;

    await db.query(
      `UPDATE reviewed_ballots SET
        outcome = COALESCE($1, outcome),
        notes = COALESCE($2, notes),
        replacement_serial_id = $3,
        photo_path = COALESCE($4, photo_path),
        reviewed_by = COALESCE($5, reviewed_by),
        reviewed_at = CASE WHEN $1 IS NOT NULL THEN NOW() ELSE reviewed_at END
       WHERE id = $6`,
      [outcome || null, notes || null, replacement_serial_id || null, photoPath, reviewed_by || null, req.params.id]
    );

    // Apply outcome side effects
    if (outcome) {
      await applyOutcome(req.params.id, outcome, candidate_id, replacement_serial_id, reviewed_by);
    }

    const { rows: [updated] } = await db.query(
      `SELECT rb.*, bs.serial_number
       FROM reviewed_ballots rb
       JOIN ballot_serials bs ON bs.id = rb.original_serial_id
       WHERE rb.id = $1`,
      [req.params.id]
    );

    const io = req.app.get('io');
    if (io) io.emit('scan:reviewed', { id: updated.id, outcome, serial_number: updated.serial_number });

    res.json(updated);
  } catch (err) {
    console.error('Update reviewed ballot error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// POST /api/reviewed-ballots/:id/photo-token — Generate a one-time mobile upload QR token
router.post('/reviewed-ballots/:id/photo-token', async (req, res) => {
  try {
    const { rows: [review] } = await db.query(
      'SELECT id FROM reviewed_ballots WHERE id = $1', [req.params.id]
    );
    if (!review) return res.status(404).json({ error: 'Review record not found' });

    const token = crypto.randomBytes(16).toString('hex');
    photoTokens.set(token, {
      reviewId: review.id,
      expiresAt: Date.now() + 30 * 60 * 1000, // 30 minutes
    });

    res.json({ token, url: `/upload-ballot-photo/${token}` });
  } catch (err) {
    console.error('Generate photo token error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/upload-ballot-photo/:token — Serve the mobile upload page
router.get('/upload-ballot-photo/:token', (req, res) => {
  const entry = photoTokens.get(req.params.token);
  if (!entry || Date.now() > entry.expiresAt) {
    return res.status(410).send('<html><body><h1>Link expired</h1><p>This upload link has expired. Please generate a new one from the admin panel.</p></body></html>');
  }

  res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Upload Ballot Photo</title>
<style>body{font-family:system-ui;max-width:400px;margin:2rem auto;padding:1rem;text-align:center}
.btn{padding:1rem 2rem;font-size:1.1rem;background:#2563eb;color:#fff;border:none;border-radius:8px;cursor:pointer;margin-top:1rem}
.warn{background:#fef3c7;border:1px solid #fbbf24;padding:0.75rem;border-radius:6px;margin:1rem 0;font-size:0.85rem;color:#92400e}
.ok{background:#dcfce7;padding:1rem;border-radius:8px;color:#166534;font-weight:700;margin-top:1rem}
</style></head><body>
<h1>Upload Ballot Photo</h1>
<div class="warn">This link only works if your device is connected to the same WiFi network as the BallotTrack server.</div>
<form id="f" enctype="multipart/form-data">
<input type="file" id="photo" accept="image/*" capture="environment" style="display:none">
<button type="button" class="btn" onclick="document.getElementById('photo').click()">Take Photo</button>
<p id="name" style="color:#666"></p>
<button type="submit" class="btn" style="display:none;background:#16a34a" id="submit">Upload Photo</button>
</form>
<div id="result"></div>
<script>
const photo=document.getElementById('photo'),name=document.getElementById('name'),submit=document.getElementById('submit'),form=document.getElementById('f');
photo.onchange=()=>{if(photo.files[0]){name.textContent=photo.files[0].name;submit.style.display='inline-block'}};
form.onsubmit=async(e)=>{e.preventDefault();if(!photo.files[0])return;
submit.disabled=true;submit.textContent='Uploading...';
const fd=new FormData();fd.append('photo',photo.files[0]);
try{const r=await fetch('/api/upload-ballot-photo/${req.params.token}',{method:'POST',body:fd});
const d=await r.json();document.getElementById('result').innerHTML=r.ok?'<div class="ok">Photo uploaded successfully!</div>':'<div style="color:red">'+d.error+'</div>';
if(r.ok){form.style.display='none'}}catch(e){document.getElementById('result').innerHTML='<div style="color:red">Upload failed</div>'}
finally{submit.disabled=false;submit.textContent='Upload Photo'}};
</script></body></html>`);
});

// POST /api/upload-ballot-photo/:token — Mobile photo upload endpoint
router.post('/upload-ballot-photo/:token', upload.single('photo'), async (req, res) => {
  try {
    const entry = photoTokens.get(req.params.token);
    if (!entry || Date.now() > entry.expiresAt) {
      return res.status(410).json({ error: 'Upload link has expired' });
    }

    if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });

    await db.query(
      'UPDATE reviewed_ballots SET photo_path = $1 WHERE id = $2',
      [req.file.path, entry.reviewId]
    );

    // Expire the token
    photoTokens.delete(req.params.token);

    res.json({ message: 'Photo uploaded successfully' });
  } catch (err) {
    console.error('Mobile photo upload error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Apply outcome side effects to ballot_serials and scans tables.
 */
async function applyOutcome(reviewId, outcome, candidateId, replacementSerialId, reviewedBy) {
  const { rows: [review] } = await db.query(
    'SELECT * FROM reviewed_ballots WHERE id = $1', [reviewId]
  );
  if (!review) return;

  if (outcome === 'counted') {
    // Ballot is valid — insert a scan record and mark as counted
    await db.query(
      "UPDATE ballot_serials SET status = 'counted' WHERE id = $1",
      [review.original_serial_id]
    );
    if (review.pass_id && candidateId) {
      await db.query(
        `INSERT INTO scans (pass_id, ballot_serial_id, candidate_id, scanned_by, image_path, omr_method)
         VALUES ($1, $2, $3, $4, $5, 'manual_review')`,
        [review.pass_id, review.original_serial_id, candidateId,
         `Review:${reviewedBy || 'admin'}`, review.image_path]
      );
    }
  } else if (outcome === 'remade') {
    // Original is damaged, replacement is counted
    await db.query(
      "UPDATE ballot_serials SET status = 'damaged' WHERE id = $1",
      [review.original_serial_id]
    );
    if (replacementSerialId) {
      await db.query(
        "UPDATE ballot_serials SET status = 'counted' WHERE id = $1",
        [replacementSerialId]
      );
    }
  } else if (outcome === 'spoiled') {
    await db.query(
      "UPDATE ballot_serials SET status = 'spoiled' WHERE id = $1",
      [review.original_serial_id]
    );
  } else if (outcome === 'rejected') {
    // Rejected = ignore this ballot in the current round, but do NOT change
    // ballot_serials.status so it can still be scanned in its correct round.
    // Delete any wrong_round_pending scan record created for this ballot.
    if (review.pass_id && review.original_serial_id) {
      await db.query(
        "DELETE FROM scans WHERE pass_id = $1 AND ballot_serial_id = $2 AND omr_method = 'wrong_round_pending'",
        [review.pass_id, review.original_serial_id]
      );
    }
  }
}

module.exports = router;
