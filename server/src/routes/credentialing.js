// credentialing.js — voter token activation + credentialing controls
// (Prompt H, stage H3).
//
// Mounted at /api/admin behind requireAuth. The replacement-token route adds
// requireSuperAdmin (the "chair-only" gate; the dedicated 'chair' role lands
// in H7 — super_admin stands in until then).

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { getSession, requireSuperAdmin } = require('../middleware/auth');
const { hashToken, generateUniqueToken } = require('../services/voterTokenService');
const {
  isVoteOpenForEvent, getCredentialingStatus, getRecentActivations, extractToken,
} = require('../services/credentialingService');
const { logFromRequest } = require('../services/auditLog');

const router = Router();

const VOTE_BASE_URL = (process.env.VOTE_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const votingUrlFor = (eventCode, token) => `${VOTE_BASE_URL}/${eventCode}/?t=${token}`;

// 30 activations / minute / credentialer — catches a scanner stuck re-reading
// one sticker. Keyed by the logged-in user so credentialers don't throttle
// each other (a convention LAN shares one gateway IP).
const activateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const s = getSession(req);
    return s ? `activate:${s.user_id}` : `activate:ip:${req.ip}`;
  },
  message: { error: 'Activation rate limit reached (30/min). Check for a stuck scanner.' },
});

function emitChanged(req, electionId) {
  const io = req.app.get('io');
  if (io) io.emit('credentialing:changed', { election_id: electionId });
}

// GET /api/admin/credentialing/events — active elections + credentialing state
// (drives the event picker on the Voter Activation page).
router.get('/credentialing/events', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT id, name, event_code, credentialing_open
         FROM elections
        WHERE status = 'active'
        ORDER BY date DESC, id DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('List credentialing events error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/credentialing/activate — activate a scanned/typed token
router.post('/credentialing/activate', activateLimiter, async (req, res) => {
  try {
    const electionId = parseInt(req.body?.electionId, 10);
    const voterType = req.body?.voterType === 'remote' ? 'remote' : 'in_person';
    const token = extractToken(req.body?.token);
    if (!electionId || !token) {
      return res.status(400).json({ error: 'An event and a token are required.' });
    }

    const { rows: [election] } = await db.query(
      'SELECT id, name, event_code, credentialing_open FROM elections WHERE id = $1', [electionId]
    );
    if (!election) return res.status(404).json({ error: 'Event not found.' });
    if (!election.credentialing_open) {
      return res.status(409).json({ error: 'Credentialing is closed for this event.' });
    }
    if (await isVoteOpenForEvent(electionId)) {
      return res.status(409).json({ error: 'Cannot credential while a vote is open. Close the vote first.' });
    }

    const hash = hashToken(token);
    // Conditional UPDATE — atomic, so two credentialers scanning the same
    // sticker at once cannot both activate it.
    const { rows: [activated] } = await db.query(
      `UPDATE voter_tokens
          SET status = 'activated', voter_type = $1, activated_at = NOW(),
              activated_by = $2, token_last2 = $3
        WHERE event_id = $4 AND token_hash = $5 AND status = 'unactivated'
        RETURNING id`,
      [voterType, req.session?.name || null, token.slice(-2), electionId, hash]
    );

    if (!activated) {
      const { rows: [existing] } = await db.query(
        'SELECT status FROM voter_tokens WHERE event_id = $1 AND token_hash = $2', [electionId, hash]
      );
      if (!existing) return res.status(404).json({ error: 'Token not found for this event.' });
      if (existing.status === 'activated') return res.status(409).json({ error: 'This token has already been activated.' });
      if (existing.status === 'revoked') return res.status(409).json({ error: 'This token has been revoked.' });
      return res.status(409).json({ error: 'This token cannot be activated.' });
    }

    await logFromRequest(req, 'token.activate', {
      targetType: 'voter_token', targetId: activated.id,
      details: { election_id: electionId, voter_type: voterType, token_last2: token.slice(-2) },
    });
    emitChanged(req, electionId);

    res.json({ token, voterType, votingUrl: votingUrlFor(election.event_code, token) });
  } catch (err) {
    console.error('Token activation error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/credentialing/:electionId/open — open the credentialing window
router.post('/credentialing/:electionId/open', async (req, res) => {
  try {
    const electionId = parseInt(req.params.electionId, 10);
    const { rows: [el] } = await db.query('SELECT id FROM elections WHERE id = $1', [electionId]);
    if (!el) return res.status(404).json({ error: 'Event not found.' });
    if (await isVoteOpenForEvent(electionId)) {
      return res.status(409).json({ error: 'Cannot open credentialing while a vote is open. Close the vote first.' });
    }
    await db.query('UPDATE elections SET credentialing_open = true WHERE id = $1', [electionId]);
    await logFromRequest(req, 'credentialing.open', { targetType: 'election', targetId: electionId });
    emitChanged(req, electionId);
    res.json({ credentialing_open: true });
  } catch (err) {
    console.error('Open credentialing error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/credentialing/:electionId/close — close the credentialing window
router.post('/credentialing/:electionId/close', async (req, res) => {
  try {
    const electionId = parseInt(req.params.electionId, 10);
    const { rows: [el] } = await db.query('SELECT id FROM elections WHERE id = $1', [electionId]);
    if (!el) return res.status(404).json({ error: 'Event not found.' });
    await db.query('UPDATE elections SET credentialing_open = false WHERE id = $1', [electionId]);
    await logFromRequest(req, 'credentialing.close', { targetType: 'election', targetId: electionId });
    emitChanged(req, electionId);
    res.json({ credentialing_open: false });
  } catch (err) {
    console.error('Close credentialing error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/credentialing/:electionId/status — counts + recent activations
router.get('/credentialing/:electionId/status', async (req, res) => {
  try {
    const electionId = parseInt(req.params.electionId, 10);
    const { rows: [el] } = await db.query(
      'SELECT id, name, event_code, credentialing_open FROM elections WHERE id = $1', [electionId]
    );
    if (!el) return res.status(404).json({ error: 'Event not found.' });
    res.json({
      election: el,
      credentialing_open: el.credentialing_open,
      vote_open: await isVoteOpenForEvent(electionId),
      counts: await getCredentialingStatus(electionId),
      recent: await getRecentActivations(electionId),
    });
  } catch (err) {
    console.error('Credentialing status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/credentialing/:electionId/replacement-token — chair-only.
// Issues a fresh activated token (the pool stores hashes only, so a poolled
// token's plaintext can't be displayed — a replacement must be freshly minted)
// and optionally revokes the voter's lost original.
router.post('/credentialing/:electionId/replacement-token', requireSuperAdmin, async (req, res) => {
  const client = await db.pool.connect();
  try {
    const electionId = parseInt(req.params.electionId, 10);
    const reason = (req.body?.reason || '').toString().trim();
    const confirmed = req.body?.confirmed === true;
    const voterType = req.body?.voterType === 'remote' ? 'remote' : 'in_person';
    const originalToken = extractToken(req.body?.originalToken);

    if (!reason) return res.status(400).json({ error: 'A reason is required.' });
    if (!confirmed) return res.status(400).json({ error: 'You must confirm the body authorized this replacement.' });

    const { rows: [election] } = await db.query(
      'SELECT id, name, event_code FROM elections WHERE id = $1', [electionId]
    );
    if (!election) return res.status(404).json({ error: 'Event not found.' });

    const { token, hash } = await generateUniqueToken(electionId);

    await client.query('BEGIN');

    let oldTokenId = null;
    if (originalToken) {
      const { rows: [orig] } = await client.query(
        `UPDATE voter_tokens SET status = 'revoked'
          WHERE event_id = $1 AND token_hash = $2 RETURNING id`,
        [electionId, hashToken(originalToken)]
      );
      if (!orig) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Original token not found for this event.' });
      }
      oldTokenId = orig.id;
    }

    const { rows: [newTok] } = await client.query(
      `INSERT INTO voter_tokens (event_id, token_hash, status, voter_type,
                                 activated_at, activated_by, token_last2)
       VALUES ($1, $2, 'activated', $3, NOW(), $4, $5) RETURNING id`,
      [electionId, hash, voterType, req.session?.name || null, token.slice(-2)]
    );
    await client.query(
      `INSERT INTO replacement_token_log (event_id, old_token_id, new_token_id, reason, authorized_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [electionId, oldTokenId, newTok.id, reason, req.session?.name || null]
    );

    await client.query('COMMIT');

    await logFromRequest(req, 'token.replace', {
      targetType: 'voter_token', targetId: newTok.id,
      details: { election_id: electionId, reason, old_token_revoked: !!oldTokenId, voter_type: voterType },
    });
    emitChanged(req, electionId);

    res.json({
      token, voterType, original_revoked: !!oldTokenId,
      votingUrl: votingUrlFor(election.event_code, token),
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Replacement token error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

module.exports = router;
