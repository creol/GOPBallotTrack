const { Router } = require('express');
const { login, getSession, sessions } = require('../middleware/auth');

const router = Router();

// POST /api/auth/login — Login with role + PIN
router.post('/login', (req, res) => {
  const { role, pin } = req.body;
  if (!role || !pin) {
    return res.status(400).json({ error: 'role and pin are required' });
  }

  const token = login(role, pin);
  if (!token) {
    return res.status(401).json({ error: 'Invalid role or PIN' });
  }

  // Set cookie (httpOnly, 24h expiry)
  res.cookie('bt_token', token, {
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax',
  });

  res.json({ token, role });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    sessions.delete(authHeader.slice(7));
  }
  const cookies = req.headers.cookie;
  if (cookies) {
    const match = cookies.split(';').map(c => c.trim()).find(c => c.startsWith('bt_token='));
    if (match) sessions.delete(match.split('=')[1]);
  }
  res.clearCookie('bt_token');
  res.json({ message: 'Logged out' });
});

// GET /api/auth/me — Get current session
router.get('/me', (req, res) => {
  const session = getSession(req);
  if (!session) return res.json({ authenticated: false });
  res.json({ authenticated: true, role: session.role });
});

module.exports = router;
