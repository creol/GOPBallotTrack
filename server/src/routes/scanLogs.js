const { Router } = require('express');
const db = require('../db');
const { writeBatch } = require('../services/scanLogService');
const { requireStationToken } = require('../middleware/auth');

const router = Router();

// POST /api/stations/:stationId/logs — Receive agent log batch
router.post('/stations/:stationId/logs', requireStationToken, async (req, res) => {
  try {
    const { stationId } = req.params;
    const { logs } = req.body;

    if (!Array.isArray(logs) || logs.length === 0) {
      return res.status(400).json({ error: 'logs array is required' });
    }

    // Resolve election_id from the station's current assignment (if any)
    let electionId = null;
    let roundId = null;
    // Look up the round the station is assigned to for context
    // Station assignments are in-memory in stations.js, but we can accept electionId/roundId from the agent
    if (logs[0]?.roundId) {
      roundId = logs[0].roundId;
      const { rows: [r] } = await db.query(
        'SELECT rc.election_id FROM rounds r JOIN races rc ON r.race_id = rc.id WHERE r.id = $1',
        [roundId]
      );
      if (r) electionId = r.election_id;
    }

    const entries = logs.map(l => ({
      electionId: l.electionId || electionId,
      source: `agent:${stationId}`,
      level: l.level || 'info',
      message: l.message,
      serialNumber: l.serialNumber || null,
      roundId: l.roundId || roundId,
      stationId,
      metadata: l.metadata || null,
      timestamp: l.timestamp,
    }));

    await writeBatch(entries);
    res.json({ received: entries.length });
  } catch (err) {
    console.error('[ScanLogs] Agent log upload error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/elections/:id/logs — Get logs for an election
router.get('/admin/elections/:id/logs', async (req, res) => {
  try {
    const { id } = req.params;
    const { source, level, limit = 500, offset = 0, serial } = req.query;

    let where = 'WHERE l.election_id = $1';
    const params = [id];
    let idx = 2;

    if (source) {
      where += ` AND l.source LIKE $${idx++}`;
      params.push(`${source}%`);
    }
    if (level) {
      where += ` AND l.level = $${idx++}`;
      params.push(level);
    }
    if (serial) {
      where += ` AND l.serial_number ILIKE $${idx++}`;
      params.push(`%${serial}%`);
    }

    const { rows } = await db.query(
      `SELECT l.* FROM scan_logs l ${where}
       ORDER BY l.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, parseInt(limit), parseInt(offset)]
    );

    const { rows: [{ count }] } = await db.query(
      `SELECT COUNT(*) as count FROM scan_logs l ${where}`,
      params
    );

    res.json({ logs: rows, total: parseInt(count) });
  } catch (err) {
    console.error('[ScanLogs] Fetch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/elections/:id/logs/matched — Get matched agent+server logs for a serial number
router.get('/admin/elections/:id/logs/matched', async (req, res) => {
  try {
    const { id } = req.params;
    const { serial } = req.query;
    if (!serial) return res.status(400).json({ error: 'serial query param required' });

    const { rows } = await db.query(
      `SELECT * FROM scan_logs
       WHERE election_id = $1 AND serial_number = $2
       ORDER BY created_at ASC`,
      [id, serial]
    );

    // Group by source type
    const agent = rows.filter(r => r.source.startsWith('agent:'));
    const serverScan = rows.filter(r => r.source === 'server:scan');
    const serverGeneral = rows.filter(r => r.source === 'server:general');

    res.json({ agent, serverScan, serverGeneral });
  } catch (err) {
    console.error('[ScanLogs] Match error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/elections/:id/logs/stats — Summary stats for the logs page
router.get('/admin/elections/:id/logs/stats', async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await db.query(
      `SELECT
         source,
         level,
         COUNT(*) as count
       FROM scan_logs
       WHERE election_id = $1
       GROUP BY source, level
       ORDER BY source, level`,
      [id]
    );

    const { rows: stations } = await db.query(
      `SELECT DISTINCT station_id, source,
         MIN(created_at) as first_seen,
         MAX(created_at) as last_seen,
         COUNT(*) as log_count
       FROM scan_logs
       WHERE election_id = $1 AND station_id IS NOT NULL
       GROUP BY station_id, source
       ORDER BY station_id`,
      [id]
    );

    res.json({ breakdown: rows, stations });
  } catch (err) {
    console.error('[ScanLogs] Stats error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
