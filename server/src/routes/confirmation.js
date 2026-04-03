const { Router } = require('express');
const {
  getComparison,
  confirmRound,
  releaseRound,
  getChairPreview,
  getChairDecision,
} = require('../services/confirmationService');

const router = Router();

// GET /api/rounds/:id/comparison — Compare all passes side-by-side
router.get('/rounds/:id/comparison', async (req, res) => {
  try {
    const data = await getComparison(parseInt(req.params.id));
    res.json(data);
  } catch (err) {
    console.error('Comparison error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rounds/:id/confirm — Election Judge confirms the round
router.post('/rounds/:id/confirm', async (req, res) => {
  try {
    const { confirmed_by_name } = req.body;
    if (!confirmed_by_name) {
      return res.status(400).json({ error: 'confirmed_by_name is required' });
    }

    const results = await confirmRound({
      roundId: parseInt(req.params.id),
      confirmedByName: confirmed_by_name,
      isOverride: false,
      overrideNotes: null,
    });

    const io = req.app.get('io');
    if (io) io.emit('round:confirmed', { round_id: parseInt(req.params.id) });

    res.json({ message: 'Round confirmed', results });
  } catch (err) {
    console.error('Confirm error:', err);
    const status = err.message.includes('required') ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// POST /api/rounds/:id/confirm-override — Election Judge overrides a mismatch
router.post('/rounds/:id/confirm-override', async (req, res) => {
  try {
    const { confirmed_by_name, override_notes } = req.body;
    if (!confirmed_by_name) {
      return res.status(400).json({ error: 'confirmed_by_name is required' });
    }
    if (!override_notes || !override_notes.trim()) {
      return res.status(400).json({ error: 'override_notes are required for overrides' });
    }

    const results = await confirmRound({
      roundId: parseInt(req.params.id),
      confirmedByName: confirmed_by_name,
      isOverride: true,
      overrideNotes: override_notes,
    });

    const io = req.app.get('io');
    if (io) io.emit('round:confirmed', { round_id: parseInt(req.params.id) });

    res.json({ message: 'Round confirmed with override', results });
  } catch (err) {
    console.error('Confirm override error:', err);
    const status = err.message.includes('required') ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/rounds/:id/chair-preview — What the public will see
router.get('/rounds/:id/chair-preview', async (req, res) => {
  try {
    const data = await getChairPreview(parseInt(req.params.id));
    res.json(data);
  } catch (err) {
    console.error('Chair preview error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rounds/:id/release — Chair approves public release
router.post('/rounds/:id/release', async (req, res) => {
  try {
    const { released_by_name } = req.body;
    if (!released_by_name) {
      return res.status(400).json({ error: 'released_by_name is required' });
    }

    await releaseRound({
      roundId: parseInt(req.params.id),
      releasedByName: released_by_name,
    });

    const io = req.app.get('io');
    if (io) io.emit('round:released', { round_id: parseInt(req.params.id) });

    res.json({ message: 'Round released to public' });
  } catch (err) {
    console.error('Release error:', err);
    const status = err.message.includes('must be') ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/rounds/:id/chair-decision — Chair decision screen data
router.get('/rounds/:id/chair-decision', async (req, res) => {
  try {
    const data = await getChairDecision(parseInt(req.params.id));
    res.json(data);
  } catch (err) {
    console.error('Chair decision error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
