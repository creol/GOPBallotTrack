const { Router } = require('express');
const multer = require('multer');
const archiver = require('archiver');
const yauzl = require('yauzl');
const fs = require('fs');
const path = require('path');
const db = require('../db');

const router = Router();

const UPLOADS_ROOT = path.join(__dirname, '..', '..', '..', 'uploads');

function safeFilename(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_');
}

function timestampSuffix() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/**
 * Build the JSON export payload for an election.
 *
 * v2 format adds:
 *   - source DB ids (election.id, race.source_id, round.source_id, candidate.source_id)
 *   - round.ballot_design_overrides
 *   - round.ballot_pdf_generated_at, round.ballot_pdf_path (passthrough hints)
 *   - _includes_ballot_files flag (true if shipped inside a ZIP)
 *
 * Ballot files themselves are NOT inlined — they live alongside this JSON inside a ZIP
 * when include_ballots=1 was requested.
 */
async function buildExportPayload(electionId, { includeFilesFlag = false } = {}) {
  const { rows: [election] } = await db.query('SELECT * FROM elections WHERE id = $1', [electionId]);
  if (!election) return null;

  const { rows: races } = await db.query(
    'SELECT * FROM races WHERE election_id = $1 ORDER BY display_order', [electionId]
  );

  for (const race of races) {
    const { rows: candidates } = await db.query(
      'SELECT * FROM candidates WHERE race_id = $1 ORDER BY display_order', [race.id]
    );
    race.candidates = candidates;

    const { rows: rounds } = await db.query(
      'SELECT * FROM rounds WHERE race_id = $1 ORDER BY round_number', [race.id]
    );

    for (const round of rounds) {
      const { rows: serials } = await db.query(
        'SELECT serial_number, status FROM ballot_serials WHERE round_id = $1 ORDER BY serial_number',
        [round.id]
      );
      round.serials = serials;
    }
    race.rounds = rounds;
  }

  const { rows: ballotBoxes } = await db.query(
    'SELECT * FROM ballot_boxes WHERE election_id = $1 ORDER BY created_at', [electionId]
  );

  const { rows: [design] } = await db.query(
    'SELECT config FROM ballot_designs WHERE election_id = $1', [electionId]
  );

  return {
    _format: 'ballottrack_election_export',
    _version: 2,
    _includes_ballot_files: !!includeFilesFlag,
    _exported_at: new Date().toISOString(),
    _source_election_id: election.id,
    election: {
      name: election.name,
      date: election.date,
      description: election.description,
    },
    ballot_design: design?.config || null,
    ballot_boxes: ballotBoxes.map(b => ({ name: b.name })),
    races: races.map(race => ({
      source_id: race.id,
      name: race.name,
      threshold_type: race.threshold_type,
      threshold_value: race.threshold_value,
      display_order: race.display_order,
      ballot_count: race.ballot_count,
      max_rounds: race.max_rounds,
      candidates: race.candidates.map(c => ({
        source_id: c.id,
        name: c.name,
        display_order: c.display_order,
        status: c.status,
      })),
      rounds: race.rounds.map(r => ({
        source_id: r.id,
        round_number: r.round_number,
        paper_color: r.paper_color,
        ballot_design_overrides: r.ballot_design_overrides || null,
        ballot_pdf_generated_at: r.ballot_pdf_generated_at || null,
        ballot_pdf_path: r.ballot_pdf_path || null,
        serials: r.serials.map(s => s.serial_number),
      })),
    })),
  };
}

// GET /api/admin/elections/:id/export-json
//   Default: returns small JSON (backward compatible).
//   ?include_ballots=1: returns a ZIP with election.json + per-round ballot files
//                       (ballots.pdf, ballot-spec.json, ballot-data.zip) so the importer
//                       can recreate the election WITHOUT regenerating ballots.
router.get('/elections/:id/export-json', async (req, res) => {
  try {
    const electionId = parseInt(req.params.id);
    const includeBallots = req.query.include_ballots === '1' || req.query.include_ballots === 'true';

    const exportData = await buildExportPayload(electionId, { includeFilesFlag: includeBallots });
    if (!exportData) return res.status(404).json({ error: 'Election not found' });

    const safeName = safeFilename(exportData.election.name);
    const ts = timestampSuffix();

    if (!includeBallots) {
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}_${ts}.json"`);
      return res.json(exportData);
    }

    // --- ZIP path: stream election.json plus per-round files
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}_${ts}_clone.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      console.error('Export ZIP error:', err);
      try { res.status(500).end(); } catch {}
    });
    archive.pipe(res);

    archive.append(JSON.stringify(exportData, null, 2), { name: 'election.json' });

    // For each round, look up the on-disk artifacts and add them to the ZIP
    // under rounds/{source_round_id}/...
    for (const race of exportData.races) {
      for (const round of race.rounds) {
        const roundDir = path.join(UPLOADS_ROOT, 'elections', String(electionId), 'rounds', String(round.source_id));
        const candidates = ['ballots.pdf', 'ballot-spec.json', 'ballot-data.zip'];
        for (const filename of candidates) {
          const filePath = path.join(roundDir, filename);
          if (fs.existsSync(filePath)) {
            archive.file(filePath, { name: `rounds/${round.source_id}/${filename}` });
          }
        }
      }
    }

    await archive.finalize();
  } catch (err) {
    console.error('Export election error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Read a ZIP buffer and return:
 *   - electionJson: parsed contents of election.json (the export payload)
 *   - filesByRound: Map<source_round_id, Map<filename, Buffer>>
 */
function readImportZip(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      let electionJson = null;
      const filesByRound = new Map();

      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        // Skip directory entries
        if (/\/$/.test(entry.fileName)) {
          zipfile.readEntry();
          return;
        }
        zipfile.openReadStream(entry, (err2, stream) => {
          if (err2) return reject(err2);
          const chunks = [];
          stream.on('data', (c) => chunks.push(c));
          stream.on('end', () => {
            const buf = Buffer.concat(chunks);
            if (entry.fileName === 'election.json') {
              try { electionJson = JSON.parse(buf.toString('utf8')); }
              catch (e) { return reject(new Error('election.json is not valid JSON: ' + e.message)); }
            } else {
              const m = entry.fileName.match(/^rounds\/(\d+)\/([^/]+)$/);
              if (m) {
                const sourceRoundId = parseInt(m[1], 10);
                const filename = m[2];
                if (!filesByRound.has(sourceRoundId)) filesByRound.set(sourceRoundId, new Map());
                filesByRound.get(sourceRoundId).set(filename, buf);
              }
              // Other entries ignored
            }
            zipfile.readEntry();
          });
          stream.on('error', reject);
        });
      });
      zipfile.on('end', () => {
        if (!electionJson) return reject(new Error('ZIP does not contain election.json'));
        resolve({ electionJson, filesByRound });
      });
      zipfile.on('error', reject);
    });
  });
}

/**
 * Rewrite a ballot-spec.json's IDs to match the newly-imported election.
 * Returns a new buffer with the updated JSON.
 */
function remapBallotSpec(specBuffer, idMaps) {
  let spec;
  try { spec = JSON.parse(specBuffer.toString('utf8')); }
  catch { return specBuffer; } // if it's not valid JSON, leave it alone

  if (typeof spec !== 'object' || spec === null) return specBuffer;

  if (typeof spec.election_id === 'number') spec.election_id = idMaps.election.get(spec.election_id) || spec.election_id;
  if (typeof spec.race_id === 'number')     spec.race_id     = idMaps.race.get(spec.race_id)     || spec.race_id;
  if (typeof spec.round_id === 'number')    spec.round_id    = idMaps.round.get(spec.round_id)   || spec.round_id;

  if (Array.isArray(spec.candidates)) {
    for (const c of spec.candidates) {
      if (c && typeof c.candidate_id === 'number') {
        const newId = idMaps.candidate.get(c.candidate_id);
        if (newId) c.candidate_id = newId;
      }
    }
  }

  // Also annotate that this spec was imported from a clone export
  spec._import_remap = {
    imported_at: new Date().toISOString(),
    source_election_id: idMaps.sourceElectionId,
  };

  return Buffer.from(JSON.stringify(spec, null, 2));
}

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB cap for clone ZIPs
});

// POST /api/admin/import-election
//   Accepts:
//     - application/json body (existing v1/v2 JSON-only flow)
//     - multipart/form-data with file field 'file' (ZIP from export-json?include_ballots=1)
router.post('/import-election', importUpload.single('file'), async (req, res) => {
  try {
    let data;
    let filesByRound = new Map();

    if (req.file && req.file.buffer) {
      // ZIP upload path
      const zipResult = await readImportZip(req.file.buffer);
      data = zipResult.electionJson;
      filesByRound = zipResult.filesByRound;
    } else {
      data = req.body;
    }

    if (!data || data._format !== 'ballottrack_election_export') {
      return res.status(400).json({ error: 'Invalid export format' });
    }

    // Build ID mappings as we insert
    const sourceElectionId = data._source_election_id || null;
    const idMaps = {
      sourceElectionId,
      election: new Map(),
      race: new Map(),
      round: new Map(),
      candidate: new Map(),
    };

    // Create election
    const { rows: [election] } = await db.query(
      `INSERT INTO elections (name, date, description)
       VALUES ($1, $2, $3) RETURNING *`,
      [data.election.name + ' (Imported)', data.election.date, data.election.description]
    );
    if (sourceElectionId) idMaps.election.set(sourceElectionId, election.id);

    for (const box of (data.ballot_boxes || [])) {
      await db.query(
        'INSERT INTO ballot_boxes (election_id, name) VALUES ($1, $2)',
        [election.id, box.name]
      );
    }

    if (data.ballot_design) {
      await db.query(
        `INSERT INTO ballot_designs (election_id, config) VALUES ($1, $2)
         ON CONFLICT (election_id) DO UPDATE SET config = $2`,
        [election.id, JSON.stringify(data.ballot_design)]
      );
    }

    const filesCopiedByNewRound = []; // for reporting
    let filesCopiedTotal = 0;

    for (const raceData of (data.races || [])) {
      const { rows: [race] } = await db.query(
        `INSERT INTO races (election_id, name, threshold_type, threshold_value, display_order, ballot_count, max_rounds)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [election.id, raceData.name, raceData.threshold_type || 'majority',
         raceData.threshold_value || null, raceData.display_order || 0,
         raceData.ballot_count || null, raceData.max_rounds || null]
      );
      if (raceData.source_id) idMaps.race.set(raceData.source_id, race.id);

      for (const candData of (raceData.candidates || [])) {
        const { rows: [cand] } = await db.query(
          `INSERT INTO candidates (race_id, name, display_order, status)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [race.id, candData.name, candData.display_order || 0, candData.status || 'active']
        );
        if (candData.source_id) idMaps.candidate.set(candData.source_id, cand.id);
      }

      for (const roundData of (raceData.rounds || [])) {
        const sourceRoundId = roundData.source_id || null;

        // v2: write ballot_design_overrides + ballot_pdf metadata if present
        const overrides = roundData.ballot_design_overrides || null;
        const { rows: [round] } = await db.query(
          `INSERT INTO rounds (race_id, round_number, paper_color, ballot_design_overrides)
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [race.id, roundData.round_number, roundData.paper_color, overrides ? JSON.stringify(overrides) : null]
        );
        if (sourceRoundId) idMaps.round.set(sourceRoundId, round.id);

        for (const sn of (roundData.serials || [])) {
          await db.query(
            `INSERT INTO ballot_serials (round_id, serial_number, status)
             VALUES ($1, $2, 'unused')`,
            [round.id, sn]
          );
        }

        // If we have per-round files from the ZIP, copy them into this new round's folder
        if (sourceRoundId && filesByRound.has(sourceRoundId)) {
          const filesMap = filesByRound.get(sourceRoundId);
          const targetDir = path.join(UPLOADS_ROOT, 'elections', String(election.id), 'rounds', String(round.id));
          fs.mkdirSync(targetDir, { recursive: true });

          const wroteFiles = [];
          for (const [filename, buf] of filesMap) {
            let writeBuf = buf;
            // Special-case ballot-spec.json: remap embedded IDs
            if (filename === 'ballot-spec.json') {
              writeBuf = remapBallotSpec(buf, idMaps);
            }
            const outPath = path.join(targetDir, filename);
            fs.writeFileSync(outPath, writeBuf);
            wroteFiles.push(filename);
            filesCopiedTotal++;
          }

          // If we copied a ballots.pdf, set the metadata AND advance status to "ready"
          // so the imported round mirrors what normal ballot generation produces and the
          // RoundDetail page shows the "Open Voting" action button.
          if (wroteFiles.includes('ballots.pdf')) {
            await db.query(
              `UPDATE rounds
                  SET ballot_pdf_path = $1,
                      ballot_pdf_generated_at = COALESCE($2, NOW()),
                      status = CASE WHEN status = 'pending_needs_action' THEN 'ready' ELSE status END
                WHERE id = $3`,
              [
                path.join('uploads', 'elections', String(election.id), 'rounds', String(round.id), 'ballots.pdf').replace(/\\/g, '/'),
                roundData.ballot_pdf_generated_at || null,
                round.id,
              ]
            );
          }

          filesCopiedByNewRound.push({ round_id: round.id, source_round_id: sourceRoundId, files: wroteFiles });
        }
      }
    }

    res.status(201).json({
      message: 'Election imported successfully',
      election_id: election.id,
      name: election.name,
      _format_version: data._version || 1,
      _includes_ballot_files: !!data._includes_ballot_files,
      files_copied_total: filesCopiedTotal,
      files_copied_by_round: filesCopiedByNewRound,
    });
  } catch (err) {
    console.error('Import election error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// POST /api/admin/rounds/:id/generate-test-ballots — Generate a PDF of test ballots with random filled ovals
router.post('/rounds/:id/generate-test-ballots', async (req, res) => {
  try {
    const roundId = parseInt(req.params.id);
    const { count, size } = req.body;
    const numBallots = Math.min(parseInt(count) || 10, 500);

    const PDFDocument = require('pdfkit');
    const fs = require('fs');
    const path = require('path');
    const { SIZES } = require('../pdf/ballotGenerator');

    // Get round data
    const { rows: [round] } = await db.query('SELECT * FROM rounds WHERE id = $1', [roundId]);
    if (!round) return res.status(404).json({ error: 'Round not found' });

    const { rows: [race] } = await db.query('SELECT * FROM races WHERE id = $1', [round.race_id]);
    const { rows: candidates } = await db.query(
      "SELECT * FROM candidates WHERE race_id = $1 AND status = 'active' ORDER BY display_order",
      [round.race_id]
    );

    // Get unused serial numbers
    const { rows: unusedSerials } = await db.query(
      "SELECT * FROM ballot_serials WHERE round_id = $1 AND status = 'unused' ORDER BY random() LIMIT $2",
      [roundId, numBallots]
    );

    if (unusedSerials.length === 0) {
      return res.status(400).json({ error: 'No unused serial numbers available for this round' });
    }

    const sizeKey = size || 'quarter_letter';
    const ballotSize = SIZES[sizeKey];
    if (!ballotSize) return res.status(400).json({ error: 'Invalid ballot size' });

    // We need renderBallot and loadDesignConfig — load them fresh to get the internal function
    const ballotGen = require('../pdf/ballotGenerator');
    const { loadDesignConfig, fetchBallotData, renderBallot } = ballotGen;

    // Output directory
    const outDir = path.join(__dirname, '..', '..', '..', 'data', 'scans', 'test-ballots', `round-${roundId}`);
    fs.mkdirSync(outDir, { recursive: true });

    const pdfPath = path.join(outDir, 'test-ballots.pdf');
    const actualCount = Math.min(numBallots, unusedSerials.length);
    const results = [];

    const { perPage, cols, rows: gridRows } = ballotSize;
    const isEighth = sizeKey === 'eighth_letter';
    const cellW = isEighth ? (4.25 * 72) : ballotSize.width;
    const cellH = isEighth ? (2.75 * 72) : ballotSize.height;
    const LETTER_W = 8.5 * 72;
    const LETTER_H = 11 * 72;
    const gridW = cols * cellW;
    const gridH = gridRows * cellH;
    const padX = (LETTER_W - gridW) / 2;
    const padY = (LETTER_H - gridH) / 2;

    // Fetch shared data
    const data = await fetchBallotData(roundId);
    const cfg = await loadDesignConfig(data.election.id, roundId);

    const doc = new PDFDocument({ size: 'LETTER', margin: 0, autoFirstPage: false });
    const pdfStream = fs.createWriteStream(pdfPath);
    doc.pipe(pdfStream);

    if (sizeKey === 'letter') {
      for (let i = 0; i < actualCount; i++) {
        const serial = unusedSerials[i];
        const votedCandidate = candidates[Math.floor(Math.random() * candidates.length)];
        doc.addPage({ size: 'LETTER', margin: 0 });
        await renderBallot(doc, 0, 0, ballotSize.width, ballotSize.height, {
          ...data, serialNumber: serial.serial_number, sizeKey, logoPath: null, cfg,
          filledCandidateId: votedCandidate.id, testMode: true,
        });
        results.push({ serial_number: serial.serial_number, voted_for: votedCandidate.name });
      }
    } else {
      let slotIndex = 0;
      for (let i = 0; i < actualCount; i++) {
        if (slotIndex % perPage === 0) {
          doc.addPage({ size: 'LETTER', margin: 0 });
        }
        const serial = unusedSerials[i];
        const votedCandidate = candidates[Math.floor(Math.random() * candidates.length)];
        const posOnPage = slotIndex % perPage;
        const col = posOnPage % cols;
        const row = Math.floor(posOnPage / cols);
        const ox = padX + col * cellW;
        const oy = padY + row * cellH;
        const ballotW = isEighth ? cellW : ballotSize.width;
        const ballotH = isEighth ? cellH : ballotSize.height;

        await renderBallot(doc, ox, oy, ballotW, ballotH, {
          ...data, serialNumber: serial.serial_number, sizeKey, logoPath: null, cfg,
          filledCandidateId: votedCandidate.id, testMode: true,
        });

        if (perPage > 1) {
          doc.save();
          doc.lineWidth(0.25).strokeColor('#ccc');
          doc.rect(ox, oy, ballotW, ballotH).stroke();
          doc.restore();
          doc.strokeColor('#000');
        }

        results.push({ serial_number: serial.serial_number, voted_for: votedCandidate.name });
        slotIndex++;
      }
    }

    doc.end();
    await new Promise((resolve, reject) => {
      pdfStream.on('finish', resolve);
      pdfStream.on('error', reject);
    });

    res.json({
      message: `Generated ${results.length} test ballots`,
      total: results.length,
      pdf_url: `/api/admin/rounds/${roundId}/test-ballot-pdf`,
      ballots: results,
    });
  } catch (err) {
    console.error('Generate test ballots error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// GET /api/admin/rounds/:id/test-ballot-pdf — Download the test ballot PDF
router.get('/rounds/:id/test-ballot-pdf', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const roundId = req.params.id;
  const pdfPath = path.join(__dirname, '..', '..', '..', 'data', 'scans', 'test-ballots', `round-${roundId}`, 'test-ballots.pdf');

  if (!fs.existsSync(pdfPath)) {
    return res.status(404).json({ error: 'No test ballots generated yet' });
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(pdfPath);
});

module.exports = router;
