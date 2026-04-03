const crypto = require('crypto');

const PINS = {
  admin: process.env.ADMIN_PIN || '1234',
  judge: process.env.JUDGE_PIN || '5678',
  chair: process.env.CHAIR_PIN || '9012',
};

// Simple token store (in-memory — fine for single-server LAN deployment)
const sessions = new Map();

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Login: validate role + PIN, return a session token.
 */
function login(role, pin) {
  if (!PINS[role]) return null;
  if (PINS[role] !== pin) return null;

  const token = generateToken();
  sessions.set(token, { role, created: Date.now() });
  return token;
}

/**
 * Get session from request (Authorization: Bearer <token> or cookie).
 */
function getSession(req) {
  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    return sessions.get(token) || null;
  }

  // Check cookie
  const cookies = req.headers.cookie;
  if (cookies) {
    const match = cookies.split(';').map(c => c.trim()).find(c => c.startsWith('bt_token='));
    if (match) {
      const token = match.split('=')[1];
      return sessions.get(token) || null;
    }
  }

  return null;
}

/**
 * Middleware: require admin or chair role.
 */
function requireAdmin(req, res, next) {
  const session = getSession(req);
  if (!session || !['admin', 'chair'].includes(session.role)) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  req.session = session;
  next();
}

/**
 * Middleware: require judge or chair role.
 */
function requireJudge(req, res, next) {
  const session = getSession(req);
  if (!session || !['judge', 'chair'].includes(session.role)) {
    return res.status(401).json({ error: 'Judge authentication required' });
  }
  req.session = session;
  next();
}

/**
 * Middleware: require chair role only.
 */
function requireChair(req, res, next) {
  const session = getSession(req);
  if (!session || session.role !== 'chair') {
    return res.status(401).json({ error: 'Chair authentication required' });
  }
  req.session = session;
  next();
}

module.exports = { login, getSession, requireAdmin, requireJudge, requireChair, sessions };
