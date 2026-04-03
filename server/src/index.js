require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cookieParser = require('cookie-parser');
const { runMigrations } = require('./migrate');
const { seed } = require('./seed');
const { requireAuth, requireAdmin, requireJudge, requireChair } = require('./middleware/auth');
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
const flaggedRouter = require('./routes/flagged');
const { startWatchers } = require('./middleware/scanWatcher');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use('/uploads', express.static(path.join(__dirname, '..', '..', 'uploads')));
app.use('/data/scans', express.static(path.join(__dirname, '..', '..', 'data', 'scans')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Make io accessible to routes
app.set('io', io);

// Auth routes (no middleware)
app.use('/api/auth', authRouter);

// Admin API routes (requireAdmin — admin or chair only)
app.use('/api/admin/elections', requireAdmin, electionsRouter);
app.use('/api/admin', requireAdmin, racesRouter);
app.use('/api/admin', requireAdmin, roundsRouter);
app.use('/api/admin', requireAdmin, ballotBoxesRouter);
app.use('/api/admin', requireAdmin, ballotsRouter);
app.use('/api/admin', requireAdmin, exportsRouter);
app.use('/api/admin', requireAdmin, ballotDesignRouter);
app.use('/api/admin', requireAdmin, scannersRouter);

// Scanning & pass routes (no PIN — tally operators access directly)
app.use('/api', passesRouter);
app.use('/api', scansRouter);

// Flagged ballot review (requireJudge — judge or chair)
app.use('/api', requireJudge, flaggedRouter);

// Confirmation routes (requireJudge for confirm, requireChair for release)
app.use('/api', confirmationRouter);

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

async function start() {
  try {
    await runMigrations();
    await seed();
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
