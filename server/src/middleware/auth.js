const crypto = require('crypto');
const db = require('../db');

// Simple token store (in-memory — fine for single-server LAN deployment)
const sessions = new Map();

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin)).digest('hex');
}

/**
 * Login: validate name + PIN against admin_users table, return a session token.
 */
async function login(name, pin) {
  const { rows: [user] } = await db.query(
    'SELECT * FROM admin_users WHERE name = $1',
    [name]
  );
  if (!user) return null;
  if (user.pin_hash !== hashPin(pin)) return null;

  const token = generateToken();
  sessions.set(token, {
    user_id: user.id,
    name: user.name,
    role: user.role,
    must_change_pin: user.must_change_pin,
    created: Date.now(),
  });
  return { token, user };
}

/**
 * Get session from request (Authorization: Bearer <token> or cookie).
 */
function getSession(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    return sessions.get(token) || null;
  }

  const cookieToken = req.cookies?.bt_token;
  if (cookieToken) {
    return sessions.get(cookieToken) || null;
  }

  return null;
}

/**
 * Middleware: require any authenticated user.
 */
function requireAuth(req, res, next) {
  const session = getSession(req);
  if (!session) {
    console.log(`[Auth] 401 on ${req.method} ${req.originalUrl}`);
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.session = session;
  next();
}

/**
 * Middleware: require super_admin role.
 */
function requireSuperAdmin(req, res, next) {
  const session = getSession(req);
  if (!session || session.role !== 'super_admin') {
    console.log(`[Auth] 401 SuperAdmin on ${req.method} ${req.originalUrl}`);
    return res.status(401).json({ error: 'Super Admin authentication required' });
  }
  req.session = session;
  next();
}

/**
 * Middleware: require super_admin OR race_admin assigned to this race.
 * Extracts raceId from req.params (raceId or id depending on route).
 */
function requireRaceAccess(req, res, next) {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.session = session;

  // Super admin has access to everything
  if (session.role === 'super_admin') return next();

  // Race admin — check assignment (async)
  const raceId = req.params.raceId || req.params.id;
  if (!raceId) return next(); // no race context, allow (other middleware may restrict)

  db.query(
    'SELECT id FROM race_admin_assignments WHERE admin_user_id = $1 AND race_id = $2',
    [session.user_id, parseInt(raceId)]
  ).then(({ rows }) => {
    if (rows.length === 0) {
      return res.status(403).json({ error: 'You do not have access to this race' });
    }
    next();
  }).catch(() => {
    res.status(500).json({ error: 'Internal server error' });
  });
}

/**
 * Verify a PIN for the current user (used for destructive actions).
 */
async function verifyPin(userId, pin) {
  const { rows: [user] } = await db.query(
    'SELECT pin_hash FROM admin_users WHERE id = $1', [userId]
  );
  if (!user) return false;
  return user.pin_hash === hashPin(pin);
}

module.exports = { login, getSession, hashPin, verifyPin, requireAuth, requireSuperAdmin, requireRaceAccess, sessions };
