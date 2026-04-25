require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const crypto = require('crypto');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cookieParser = require('cookie-parser');
const db = require('./db');
const { hashPin } = require('./middleware/auth');
const { runMigrations } = require('./migrate');
const { seed } = require('./seed');
const { requireAuth, requireSuperAdmin, requireRaceAccess } = require('./middleware/auth');
const { APP_VERSION } = require('./version');
const authRouter = require('./routes/auth');
const electionsRouter = require('./routes/elections');
const racesRouter = require('./routes/races');
const roundsRouter = require('./routes/rounds');
const ballotBoxesRouter = require('./routes/ballotBoxes');
const ballotsRouter = require('./routes/ballots');
const passesRouter = require('./routes/passes');
const scansRouter = require('./routes/scans');
const confirmationRouter = require('./routes/confirmation');
const publicRouter = require('./routes/public');
const exportsRouter = require('./routes/exports');
const ballotDesignRouter = require('./routes/ballotDesign');
const scannersRouter = require('./routes/scanners');
const adminUsersRouter = require('./routes/adminUsers');
const controlCenterRouter = require('./routes/controlCenter');
const testToolsRouter = require('./routes/testTools');
const ballotSpecRecoveryRouter = require('./routes/ballotSpecRecovery');
const stationsRouter = require('./routes/stations');
const scanLogsRouter = require('./routes/scanLogs');
const reviewedBallotsRouter = require('./routes/reviewedBallots');
const { startWatchers } = require('./middleware/scanWatcher');

// Station agent auth bootstrap.
// - In non-prod: generate a random token at boot so the dev loop works without config.
// - In prod: DO NOT exit if unset — the admin UI has to stay reachable so the operator can
//   log in and fix things. Instead, loud-warn. Agent POSTs will 503 cleanly via the
//   requireStationToken middleware until STATION_TOKEN is set and the container restarted.
if (!process.env.STATION_TOKEN) {
  if (process.env.NODE_ENV === 'production') {
    console.error('\x1b[31m================================================================');
    console.error('⚠  STATION_TOKEN env var is NOT set. All /api/stations agent endpoints');
    console.error('   will return 503 until this is fixed. Set STATION_TOKEN in the');
    console.error('   environment and restart the container. Admin UI still works.');
    console.error('================================================================\x1b[0m');
  } else {
    process.env.STATION_TOKEN = crypto.randomBytes(32).toString('hex');
    console.warn(`\x1b[33m[Security] STATION_TOKEN not set — using a random dev value. Put this in .env to persist: STATION_TOKEN=${process.env.STATION_TOKEN}\x1b[0m`);
  }
}

const app = express();
const server = http.createServer(app);

// Trust the first proxy (AWS ELB / nginx) so rate-limit and logs see the real client IP.
app.set('trust proxy', 1);

const isProd = process.env.NODE_ENV === 'production';

// In prod the React build is served same-origin by Express — no cross-origin API calls.
// In dev the Vite dev server lives on :5173 and calls the API on :3000, so allow any origin.
// Socket.io mirrors the same policy.
const io = new Server(server, {
  cors: isProd ? { origin: false } : { origin: '*' },
});
app.use(cors(isProd ? { origin: false, credentials: true } : { origin: true, credentials: true }));

// Basic security headers. CSP is disabled because the React build uses inline styles
// extensively; tuning CSP properly is its own project.
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

app.use(express.json({ limit: '100mb' }));
app.use(cookieParser());
app.use('/uploads', express.static(path.join(__dirname, '..', '..', 'uploads')));
app.use('/data/scans', express.static(path.join(__dirname, '..', '..', 'data', 'scans')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: APP_VERSION, timestamp: new Date().toISOString() });
});

// Make io accessible to routes
app.set('io', io);

// Auth routes (no middleware)
app.use('/api/auth', authRouter);

// Station endpoints (no auth — trusted LAN, must be before auth-protected routes)
app.use('/api', stationsRouter);
app.use('/api', scanLogsRouter); // Agent log upload (no auth) + admin log views (auth applied in router)

// Admin API routes (requireAuth — any authenticated admin user)
app.use('/api/admin/elections', requireAuth, electionsRouter);
app.use('/api/admin', requireAuth, racesRouter);
app.use('/api/admin', requireAuth, roundsRouter);
app.use('/api/admin', requireAuth, ballotBoxesRouter);
app.use('/api/admin', requireAuth, ballotsRouter);
app.use('/api/admin', requireAuth, exportsRouter);
app.use('/api/admin', requireAuth, ballotDesignRouter);
app.use('/api/admin', requireAuth, scannersRouter);

// User management (super_admin only)
app.use('/api/admin', requireSuperAdmin, adminUsersRouter);

// Control Center (super_admin only)
app.use('/api/admin/control-center', requireSuperAdmin, controlCenterRouter);

// Test tools and import/export (any authenticated user)
app.use('/api/admin', requireAuth, testToolsRouter);

// Ballot-spec recovery from printed PDF (any authenticated user)
app.use('/api/admin', requireAuth, ballotSpecRecoveryRouter);

// Scanning & pass routes (no PIN — tally operators access directly)
app.use('/api', passesRouter);
app.use('/api', scansRouter);

// Reviewed ballots — admin routes + public mobile photo upload (token-gated)
app.use('/api', reviewedBallotsRouter);

// Confirmation routes (mounted at /api/admin to avoid blocking public routes)
app.use('/api/admin', requireAuth, confirmationRouter);

// Public API routes (no auth)
app.use('/api/public', publicRouter);

// Serve static React build in production
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// WebSocket connection
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;

/**
 * Flag any super_admin user whose PIN still matches one of the well-known defaults
 * from .env.example. Does not block startup — this is a loud reminder so an operator
 * who inherited a stock install notices before an event.
 */
async function checkDefaultPins() {
  const knownDefaults = ['1234', '5678', '9012', 'admin', 'password'];
  try {
    const { rows } = await db.query("SELECT id, name, pin_hash FROM admin_users WHERE role = 'super_admin'");
    const weak = [];
    for (const u of rows) {
      for (const d of knownDefaults) {
        if (u.pin_hash === hashPin(d)) { weak.push({ name: u.name, pin: d }); break; }
      }
    }
    if (weak.length > 0) {
      console.warn('\x1b[31m');
      console.warn('================================================================');
      console.warn('⚠  DEFAULT / WEAK SUPER ADMIN PIN IN USE');
      for (const w of weak) {
        console.warn(`   ${w.name}: PIN "${w.pin}"`);
      }
      console.warn('   Change it via the admin UI before going live.');
      console.warn('================================================================');
      console.warn('\x1b[0m');
    }
  } catch (err) {
    // Non-fatal — if the check itself fails, startup continues silently.
    console.warn('[Security] Default-PIN check skipped:', err.message);
  }
}

async function start() {
  try {
    await runMigrations();
    await seed();
    await checkDefaultPins();
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`BallotTrack server listening on port ${PORT}`);
      startWatchers(io);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
