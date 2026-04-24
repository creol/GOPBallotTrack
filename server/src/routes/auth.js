const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { login, getSession, hashPin, sessions } = require('../middleware/auth');

const router = Router();

// Strict limiter for login attempts — keyed by username so one user's bad PIN
// doesn't lock out everyone else on the same LAN (convention attendees share a gateway IP).
// Successful logins reset the counter so a real admin who finally gets their PIN right
// can keep working.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const name = (req.body?.name || req.body?.role || '').toString().trim().toLowerCase();
    return name ? `login:${name}` : `login:ip:${req.ip}`;
  },
  message: { error: 'Too many PIN attempts for this user. Try again in 15 minutes.' },
});

// Verify-super-admin-pin has no username in the request (any super admin's PIN is accepted),
// so this one has to fall back to per-IP rate limiting.
const superAdminPinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many super admin PIN attempts. Try again in 15 minutes.' },
});

// Broader limiter on all /auth routes so other entry points (change-pin, me, logout) can't
// be used to probe at high rates either.
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests.' },
});
router.use(authLimiter);

// POST /api/auth/login — Login with name + PIN
router.post('/login', loginLimiter, async (req, res) => {
  const { name, pin, role } = req.body;

  // Support legacy role+pin login for backward compatibility (e.g., PIN verification dialogs)
  if (role && pin && !name) {
    // Legacy: verify admin PIN — look up any super_admin
    const { rows } = await db.query(
      "SELECT * FROM admin_users WHERE role = 'super_admin' LIMIT 1"
    );
    if (rows.length > 0 && rows[0].pin_hash === hashPin(pin)) {
      return res.json({ role: rows[0].role, token: null, verified: true });
    }
    return res.status(401).json({ error: 'Invalid PIN' });
  }

  if (!name || !pin) {
    return res.status(400).json({ error: 'name and pin are required' });
  }

  const result = await login(name, pin);
  if (!result) {
    return res.status(401).json({ error: 'Invalid name or PIN' });
  }

  const { token, user } = result;

  // Set cookie (httpOnly, 24h expiry)
  res.cookie('bt_token', token, {
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax',
  });

  res.json({
    token,
    role: user.role,
    user_id: user.id,
    name: user.name,
    must_change_pin: user.must_change_pin,
  });
});

// POST /api/auth/verify-super-admin-pin — Verify a PIN belongs to any super_admin.
// Used by destructive admin actions (Recount, Void, Reverse Finalize, etc.) that require
// super admin approval — any super admin's PIN is accepted, not just "the Admin".
router.post('/verify-super-admin-pin', superAdminPinLimiter, async (req, res) => {
  const { pin } = req.body || {};
  if (!pin) return res.status(400).json({ error: 'PIN is required' });
  try {
    const hashed = hashPin(pin);
    const { rows } = await db.query(
      "SELECT id, name FROM admin_users WHERE role = 'super_admin' AND pin_hash = $1 LIMIT 1",
      [hashed]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Invalid super admin PIN' });
    res.json({ ok: true, admin_id: rows[0].id, admin_name: rows[0].name });
  } catch (err) {
    console.error('verify-super-admin-pin error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/change-pin — Change own PIN
router.post('/change-pin', async (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Authentication required' });

  const { current_pin, new_pin } = req.body;
  if (!new_pin || new_pin.length < 4) {
    return res.status(400).json({ error: 'New PIN must be at least 4 characters' });
  }

  const { rows: [user] } = await db.query(
    'SELECT * FROM admin_users WHERE id = $1', [session.user_id]
  );
  if (!user) return res.status(404).json({ error: 'User not found' });

  // If must_change_pin, don't require current PIN
  if (!user.must_change_pin) {
    if (!current_pin || user.pin_hash !== hashPin(current_pin)) {
      return res.status(401).json({ error: 'Current PIN is incorrect' });
    }
  }

  await db.query(
    'UPDATE admin_users SET pin_hash = $1, must_change_pin = false WHERE id = $2',
    [hashPin(new_pin), session.user_id]
  );

  // Update session
  session.must_change_pin = false;

  res.json({ message: 'PIN changed successfully' });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    sessions.delete(authHeader.slice(7));
  }
  const cookieToken = req.cookies?.bt_token;
  if (cookieToken) sessions.delete(cookieToken);
  res.clearCookie('bt_token');
  res.json({ message: 'Logged out' });
});

// GET /api/auth/me — Get current session
router.get('/me', (req, res) => {
  const session = getSession(req);
  if (!session) return res.json({ authenticated: false });
  res.json({
    authenticated: true,
    role: session.role,
    user_id: session.user_id,
    name: session.name,
    must_change_pin: session.must_change_pin,
  });
});

module.exports = router;
