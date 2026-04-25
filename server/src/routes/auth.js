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

// Verify-super-admin-pin is now bound to the logged-in session user, so we
// can rate-limit per user. Successful verifies don't count, so a real super
// admin who fat-fingers once isn't penalized.
const superAdminPinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const session = getSession(req);
    return session ? `superadmin-pin:${session.user_id}` : `superadmin-pin:ip:${req.ip}`;
  },
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

  // Legacy role+pin verification path. Pre-fix this looked up `WHERE role = 'super_admin' LIMIT 1`,
  // which only matched the first super admin's PIN — every other super admin's correct PIN was
  // reported as "Invalid" even though their account was fine. Now we bind to the logged-in
  // session user so the only PIN that succeeds is the operator's own, matching the user's
  // expectation that "the super admin logged in" approves the action.
  if (role && pin && !name) {
    const session = getSession(req);
    if (!session || session.role !== 'super_admin') {
      return res.status(401).json({ error: 'Super Admin session required' });
    }
    const { rows: [user] } = await db.query(
      "SELECT pin_hash FROM admin_users WHERE id = $1 AND role = 'super_admin'",
      [session.user_id]
    );
    if (!user || user.pin_hash !== hashPin(pin)) {
      return res.status(401).json({ error: 'Invalid PIN' });
    }
    return res.json({ role: 'super_admin', token: null, verified: true });
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

// POST /api/auth/verify-super-admin-pin — Verify the LOGGED-IN super admin's PIN.
// Bound to the session user so an operator can only approve actions with their own PIN.
// (Pre-fix this accepted any super admin's PIN, which made the modal pre-check disagree
// with the destructive endpoint and produced "Invalid" messages even for correct PINs.)
router.post('/verify-super-admin-pin', superAdminPinLimiter, async (req, res) => {
  const { pin } = req.body || {};
  if (!pin) return res.status(400).json({ error: 'PIN is required' });
  try {
    const session = getSession(req);
    if (!session || session.role !== 'super_admin') {
      return res.status(401).json({ error: 'Super Admin session required' });
    }
    const { rows: [user] } = await db.query(
      "SELECT id, name, pin_hash FROM admin_users WHERE id = $1 AND role = 'super_admin'",
      [session.user_id]
    );
    if (!user || user.pin_hash !== hashPin(pin)) {
      return res.status(401).json({ error: 'Invalid Super Admin PIN' });
    }
    res.json({ ok: true, admin_id: user.id, admin_name: user.name });
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
