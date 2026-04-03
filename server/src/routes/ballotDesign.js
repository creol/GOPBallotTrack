const { Router } = require('express');
const db = require('../db');

const router = Router();

const DEFAULT_CONFIG = {
  header: {
    show: true,
    electionNameSize: 16,
    raceNameSize: 14,
    roundInfoSize: 10,
  },
  logo: {
    show: false,
    position: 'top-left', // top-left, top-right, top-center
    maxWidth: 48,
  },
  candidates: {
    fontSize: 11,
    ovalSize: 'medium', // small, medium, large
    spacing: 'normal', // compact, normal, spacious
  },
  instructions: {
    show: true,
    text: 'Do NOT bend. Completely fill the oval of your vote.',
    fontSize: 8,
  },
  encouragement: {
    show: true,
    text: 'You are encouraged to take a photo of your completed ballot before submitting for your validation.',
    fontSize: 8,
  },
  examples: {
    show: true,
  },
  notes: {
    show: false,
    text: '',
    fontSize: 8,
    position: 'below-instructions', // below-instructions, above-footer
  },
  qr: {
    show: true,
    position: 'bottom-right', // bottom-right, bottom-left, bottom-center
  },
  sn: {
    show: true,
  },
};

// GET /api/admin/elections/:id/ballot-design — Get design config
router.get('/elections/:id/ballot-design', async (req, res) => {
  try {
    const { rows: [design] } = await db.query(
      'SELECT * FROM ballot_designs WHERE election_id = $1',
      [req.params.id]
    );
    if (!design) {
      return res.json({ election_id: parseInt(req.params.id), config: DEFAULT_CONFIG });
    }
    // Merge with defaults so new fields are always present
    const merged = { ...DEFAULT_CONFIG };
    for (const key of Object.keys(merged)) {
      if (design.config[key]) {
        merged[key] = { ...merged[key], ...design.config[key] };
      }
    }
    res.json({ ...design, config: merged });
  } catch (err) {
    console.error('Get ballot design error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/elections/:id/ballot-design — Save design config
router.put('/elections/:id/ballot-design', async (req, res) => {
  try {
    const { config } = req.body;
    if (!config) return res.status(400).json({ error: 'config is required' });

    const { rows: [existing] } = await db.query(
      'SELECT id FROM ballot_designs WHERE election_id = $1',
      [req.params.id]
    );

    let design;
    if (existing) {
      const { rows: [updated] } = await db.query(
        `UPDATE ballot_designs SET config = $1, updated_at = NOW()
         WHERE election_id = $2 RETURNING *`,
        [JSON.stringify(config), req.params.id]
      );
      design = updated;
    } else {
      const { rows: [created] } = await db.query(
        `INSERT INTO ballot_designs (election_id, config)
         VALUES ($1, $2) RETURNING *`,
        [req.params.id, JSON.stringify(config)]
      );
      design = created;
    }

    res.json(design);
  } catch (err) {
    console.error('Save ballot design error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/elections/:id/ballot-design/defaults — Get default config
router.get('/elections/:id/ballot-design/defaults', (req, res) => {
  res.json(DEFAULT_CONFIG);
});

module.exports = router;
module.exports.DEFAULT_CONFIG = DEFAULT_CONFIG;
