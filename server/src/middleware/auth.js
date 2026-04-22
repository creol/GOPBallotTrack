const crypto = require('crypto');
const db = require('../db');

// Simple token store (in-memory — fine for single-server LAN deployment)
const sessions = new Map();

// Server-side session lifetime. Cookie maxAge is 24h; this is the effective limit because
// getSession evicts anything older so a stolen cookie can't be reused past the window.
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

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
 * Evicts sessions older than SESSION_TTL_MS so expired cookies can't be reused.
 */
function getSession(req) {
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (req.cookies?.bt_token) {
    token = req.cookies.bt_token;
  }
  if (!token) return null;

  const session = sessions.get(token);
  if (!session) return null;

  if (session.created && Date.now() - session.created > SESSION_TTL_MS) {
    sessions.delete(token);
    return null;
  }
  return session;
}

/**
 * Middleware: accept EITHER an admin session OR a valid X-Station-Token header.
 * Used on endpoints that both humans (admins pulling the bundle for distribution) and
 * machines (a running .bat installer on a station laptop) need to hit.
 */
function requireAuthOrStationToken(req, res, next) {
  const session = getSession(req);
  if (session) {
    req.session = session;
    return next();
  }
  const expected = process.env.STATION_TOKEN;
  const provided = req.headers['x-station-token'];
  if (expected && provided) {
    const a = Buffer.from(String(provided));
    const b = Buffer.from(String(expected));
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  }
  return res.status(401).json({ error: 'Authentication or station token required' });
}

/**
 * Middleware: validate the X-Station-Token header against the STATION_TOKEN env var
 * (timing-safe). Used to gate all state-changing station agent endpoints so anyone on
 * the LAN who isn't provisioned can't spoof heartbeats, assignments, or ballot uploads.
 */
function requireStationToken(req, res, next) {
  const expected = process.env.STATION_TOKEN;
  if (!expected) {
    console.error('[Auth] STATION_TOKEN env var is not set — rejecting station request');
    return res.status(503).json({ error: 'Server not configured: STATION_TOKEN missing' });
  }
  const provided = req.headers['x-station-token'];
  if (!provided) return res.status(401).json({ error: 'Station token required' });

  // timingSafeEqual needs equal-length buffers
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: 'Invalid station token' });
  }
  next();
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

module.exports = { login, getSession, hashPin, verifyPin, requireAuth, requireSuperAdmin, requireRaceAccess, requireStationToken, requireAuthOrStationToken, sessions };
