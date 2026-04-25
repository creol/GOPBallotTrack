/**
 * Ballot-spec recovery service.
 *
 * Used when printed paper no longer matches the on-disk ballot-spec.json (because
 * ballots were regenerated AFTER printing, etc.). Reads the PDF that was actually
 * printed, extracts QR + oval positions directly from the drawing operators, and
 * writes a corrected ballot-spec.json into every round of a race so OMR aligns
 * with the physical paper.
 *
 * Two entry points used by both CLI scripts and the admin API:
 *
 *   extractDraftSpecFromPdf({ pdfBuffer | pdfPath, ... })
 *     -> { draftSpec, info } — no DB, no file writes
 *
 *   applyDraftSpecToRace({ draftSpec, raceId, db, ... })
 *     -> { rounds_updated, candidate_matches, ... } — needs DB, writes spec files
 *
 *   recoverAndApplyForRace({ pdfBuffer, raceId, db, ... })
 *     -> end-to-end (extract + apply) used by the API "apply" endpoint
 */

const fs = require('fs');
const path = require('path');

const LETTER_W = 612;
const LETTER_H = 792;
const PTS_TO_PX = 300 / 72;

const SIZE_DIMS = {
  letter:         { w: 612,  h: 792, perPage: 1, cols: 1, rows: 1 },
  half_letter:    { w: 396,  h: 612, perPage: 2, cols: 1, rows: 2 },
  quarter_letter: { w: 306,  h: 396, perPage: 4, cols: 2, rows: 2 },
  eighth_letter:  { w: 198,  h: 306, perPage: 8, cols: 2, rows: 4 },
};

// ---------------------------------------------------------------------------
// PDF parsing helpers
// ---------------------------------------------------------------------------

function multiplyMatrix(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/** PDFKit's doc.ellipse() emits exactly: m + 4c + h. Recover {cx, cy, rx, ry}. */
function ellipseFromConstructPath(args) {
  const [pathOps, coords] = args;
  if (!pathOps || pathOps.length !== 6) return null;
  const expected = [13, 15, 15, 15, 15, 18];
  for (let i = 0; i < 6; i++) if (pathOps[i] !== expected[i]) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let j = 0; j < coords.length; j += 2) {
    const x = coords[j], y = coords[j + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    rx: (maxX - minX) / 2,
    ry: (maxY - minY) / 2,
  };
}

function detectBallotSize(pageWidth, pageHeight, qrCount) {
  if (Math.abs(pageWidth - 612) > 1 || Math.abs(pageHeight - 792) > 1) {
    throw new Error(`Page is not Letter-sized (got ${pageWidth}x${pageHeight}). PDFKit always outputs Letter pages.`);
  }
  if (qrCount === 1) return 'letter';
  if (qrCount === 2) return 'half_letter';
  if (qrCount === 4) return 'quarter_letter';
  if (qrCount === 8) return 'eighth_letter';
  throw new Error(`Cannot detect ballot size: found ${qrCount} QR-sized images on page 1 (expected 1, 2, 4, or 8)`);
}

const pdfYtoApiY = (pdfY) => LETTER_H - pdfY;

async function readPdfPage1Drawing(pdfData) {
  // Lazy-load pdfjs-dist (it's ~7MB and only used during recovery)
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.mjs');
  // pdfjs-dist 4.x requires a real Uint8Array, not a Buffer subclass.
  // Buffer.byteOffset/byteLength matter when the buffer was sliced from a pool.
  const data = (pdfData && pdfData.constructor && pdfData.constructor.name === 'Uint8Array')
    ? pdfData
    : new Uint8Array(pdfData.buffer ? pdfData.buffer.slice(pdfData.byteOffset, pdfData.byteOffset + pdfData.byteLength) : pdfData);
  const pdfDoc = await pdfjs.getDocument({ data, disableFontFace: true, useSystemFonts: false, verbosity: 0 }).promise;
  if (pdfDoc.numPages < 1) throw new Error('PDF has no pages');
  const page = await pdfDoc.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const opList = await page.getOperatorList();
  const OPS = pdfjs.OPS;

  const images = [];
  const ellipses = [];

  let ctm = [1, 0, 0, 1, 0, 0];
  const ctmStack = [];

  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];
    if (fn === OPS.save) {
      ctmStack.push(ctm);
    } else if (fn === OPS.restore) {
      ctm = ctmStack.pop() || [1, 0, 0, 1, 0, 0];
    } else if (fn === OPS.transform) {
      ctm = multiplyMatrix(ctm, args);
    } else if (fn === OPS.paintImageXObject || fn === OPS.paintImageMaskXObject) {
      const [a, b, c, d, e, f] = ctm;
      const width = Math.hypot(a, b);
      const height = Math.hypot(c, d);
      images.push({ x_pdf: e, y_pdf: f, width, height });
    } else if (fn === OPS.constructPath) {
      const ell = ellipseFromConstructPath(args);
      if (ell) ellipses.push(ell);
    }
  }

  const tc = await page.getTextContent();
  const texts = [];
  for (const it of tc.items) {
    if (!it.str) continue;
    const str = it.str.trim();
    if (!str) continue;
    texts.push({
      str,
      x: it.transform[4],
      y_pdf: it.transform[5],
      y_api: pdfYtoApiY(it.transform[5]),
      fontSize: it.height || 0,
    });
  }

  return { pageWidth: viewport.width, pageHeight: viewport.height, images, ellipses, texts };
}

function isolateCell(raw, ox, oy, cellW, cellH) {
  const apiXMin = ox, apiXMax = ox + cellW;
  const apiYMin = oy, apiYMax = oy + cellH;
  const pdfYMin = LETTER_H - apiYMax, pdfYMax = LETTER_H - apiYMin;

  const ellipses = raw.ellipses.filter(e =>
    e.cx >= apiXMin && e.cx <= apiXMax && e.cy >= apiYMin && e.cy <= apiYMax
  );
  const images = raw.images.filter(img => {
    const imgL = img.x_pdf, imgB = img.y_pdf;
    const imgR = imgL + img.width, imgT = imgB + img.height;
    return imgL >= ox - 1 && imgR <= ox + cellW + 1 && imgB >= pdfYMin - 1 && imgT <= pdfYMax + 1;
  });
  const texts = raw.texts.filter(t =>
    t.x >= apiXMin && t.x <= apiXMax && t.y_api >= apiYMin && t.y_api <= apiYMax
  );
  return { ellipses, images, texts };
}

function findCandidateOvals(cellEllipses) {
  if (cellEllipses.length === 0) return [];
  const groups = new Map();
  for (const e of cellEllipses) {
    const key = `${e.rx.toFixed(1)},${e.ry.toFixed(1)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  let bestKey = null, bestCount = -1;
  for (const [key, arr] of groups) {
    if (arr.length > bestCount) { bestCount = arr.length; bestKey = key; }
  }
  if (bestCount < 2 || groups.size > 1) {
    let largestRx = -1;
    for (const [key, arr] of groups) {
      if (arr.length === bestCount) {
        const rx = arr[0].rx;
        if (rx > largestRx) { largestRx = rx; bestKey = key; }
      }
    }
  }
  const candidateOvals = groups.get(bestKey) || [];
  candidateOvals.sort((a, b) => a.cy - b.cy);
  return candidateOvals;
}

function findQrImage(cellImages, ox, oy, cellW, cellH) {
  if (cellImages.length === 0) return null;
  const squares = cellImages.filter(img => {
    const ar = img.width / Math.max(img.height, 0.1);
    return ar >= 0.85 && ar <= 1.15;
  });
  if (squares.length === 0) return null;
  let best = null, bestScore = -Infinity;
  for (const img of squares) {
    const cx = img.x_pdf + img.width / 2;
    const cy = img.y_pdf + img.height / 2;
    const targetCx = ox + cellW * 0.8;
    const targetCy = (LETTER_H - (oy + cellH)) + cellH * 0.2;
    const dx = cx - targetCx, dy = cy - targetCy;
    const score = -(dx * dx + dy * dy);
    if (score > bestScore) { bestScore = score; best = img; }
  }
  return best;
}

function findCandidateNamesForOvals(cellTexts, candidateOvals) {
  if (candidateOvals.length === 0) return [];
  const ovalRy = candidateOvals[0].ry;
  const yTol = ovalRy + 4;
  const matches = [];
  const usedTextIdxs = new Set();
  for (const oval of candidateOvals) {
    let bestIdx = -1, bestDist = Infinity;
    for (let i = 0; i < cellTexts.length; i++) {
      if (usedTextIdxs.has(i)) continue;
      const t = cellTexts[i];
      if (t.x < oval.cx + oval.rx) continue;
      const dist = Math.abs(t.y_api - oval.cy);
      if (dist > yTol) continue;
      if (!t.str || t.str.trim().length === 0) continue;
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    }
    if (bestIdx >= 0) { matches.push(cellTexts[bestIdx].str); usedTextIdxs.add(bestIdx); }
    else matches.push(null);
  }
  return matches;
}

const ptToPx = (pt) => Math.round(pt * PTS_TO_PX);

// ---------------------------------------------------------------------------
// Public API: extract
// ---------------------------------------------------------------------------

/**
 * Extract a draft ballot-spec from a printed PDF.
 *
 * Inputs (one of):
 *   - pdfBuffer: Buffer or Uint8Array of the PDF bytes
 *   - pdfPath:   filesystem path to the PDF
 *
 * Options:
 *   - ballotSize:           force a ballot size key ('quarter_letter' etc.); default auto-detect
 *   - candidatesOverride:   array of name strings overriding name detection (must match oval count)
 *
 * Returns:
 *   - draftSpec:  { ballot_size, dpi, qr_code, candidates: [...], omr_thresholds, _recovery }
 *                 candidate_id is null in the draft (filled in by the apply step)
 *   - info:       { qr_position_pts, candidate_ovals_pts, header_text_strings }
 *                 — handy for debug/preview
 */
async function extractDraftSpecFromPdf({ pdfBuffer, pdfPath, ballotSize, candidatesOverride, sourceName }) {
  const data = pdfBuffer || fs.readFileSync(pdfPath);
  const raw = await readPdfPage1Drawing(data);

  const qrSquares = raw.images.filter(img => {
    const ar = img.width / Math.max(img.height, 0.1);
    return ar >= 0.85 && ar <= 1.15 && img.width >= 40 && img.width <= 110;
  });
  const sizeKey = ballotSize || detectBallotSize(raw.pageWidth, raw.pageHeight, qrSquares.length);
  const dims = SIZE_DIMS[sizeKey];
  if (!dims) throw new Error(`Unknown ballot size: ${sizeKey}`);

  let cellW, cellH, ox, oy;
  if (sizeKey === 'letter') {
    cellW = LETTER_W; cellH = LETTER_H; ox = 0; oy = 0;
  } else if (sizeKey === 'eighth_letter') {
    cellW = 4.25 * 72; cellH = 2.75 * 72;
    ox = (LETTER_W - dims.cols * cellW) / 2;
    oy = (LETTER_H - dims.rows * cellH) / 2;
  } else {
    cellW = dims.w; cellH = dims.h;
    ox = (LETTER_W - dims.cols * cellW) / 2;
    oy = (LETTER_H - dims.rows * cellH) / 2;
  }

  const cell = isolateCell(raw, ox, oy, cellW, cellH);
  const qrImage = findQrImage(cell.images, ox, oy, cellW, cellH);
  if (!qrImage) throw new Error('No QR-like image found in top-left cell. Was this generated with a custom no-QR config?');

  const qrApiYTop = pdfYtoApiY(qrImage.y_pdf + qrImage.height);
  const qrCellLocal = {
    x: qrImage.x_pdf - ox,
    y: qrApiYTop - oy,
    width: qrImage.width,
    height: qrImage.height,
  };

  const candidateOvals = findCandidateOvals(cell.ellipses);
  if (candidateOvals.length === 0) throw new Error('No candidate ovals found in top-left cell.');

  let candidateNames;
  if (candidatesOverride) {
    if (candidatesOverride.length !== candidateOvals.length) {
      throw new Error(`candidatesOverride count (${candidatesOverride.length}) does not match oval count (${candidateOvals.length})`);
    }
    candidateNames = candidatesOverride;
  } else {
    candidateNames = findCandidateNamesForOvals(cell.texts, candidateOvals);
    const missingIdx = candidateNames.findIndex(n => !n);
    if (missingIdx >= 0) {
      throw new Error(`Could not match every oval to a candidate name (oval ${missingIdx + 1} at cy=${candidateOvals[missingIdx].cy.toFixed(2)} has no nearby text). Use candidatesOverride to specify names manually.`);
    }
  }

  const qrPx = {
    corner: 'bottom-right',
    encoding: 'plain_serial_number',
    x: ptToPx(qrCellLocal.x),
    y: ptToPx(qrCellLocal.y),
    width: ptToPx(qrCellLocal.width),
    height: ptToPx(qrCellLocal.height),
  };

  const candidates = candidateOvals.map((ov, i) => ({
    candidate_id: null,
    name: candidateNames[i],
    oval: {
      x_offset_from_qr: ptToPx(ov.cx - qrCellLocal.x),
      y_offset_from_qr: ptToPx(ov.cy - qrCellLocal.y),
      x: ptToPx(ov.cx - ov.rx),
      y: ptToPx(ov.cy - ov.ry),
      width: ptToPx(ov.rx * 2),
      height: ptToPx(ov.ry * 2),
    },
  }));

  const draftSpec = {
    _recovery: {
      source_pdf: sourceName || (pdfPath ? path.basename(pdfPath) : 'uploaded'),
      extracted_at: new Date().toISOString(),
      tool_version: 1,
    },
    election_id: null,
    race_id: null,
    round_id: null,
    ballot_size: sizeKey,
    dpi: 300,
    qr_code: qrPx,
    candidates,
    omr_thresholds: { marked: 0.20, unmarked: 0.10 },
  };

  return {
    draftSpec,
    info: {
      ballot_size: sizeKey,
      qr_position_pts: { x: qrCellLocal.x, y: qrCellLocal.y, width: qrCellLocal.width, height: qrCellLocal.height },
      candidate_ovals_pts: candidateOvals.map((ov, i) => ({
        name: candidateNames[i],
        cx: ov.cx, cy: ov.cy, rx: ov.rx, ry: ov.ry,
      })),
      header_text_strings: cell.texts
        .filter(t => t.y_api < (candidateOvals[0]?.cy || 100))
        .map(t => t.str),
    },
  };
}

// ---------------------------------------------------------------------------
// Public API: apply
// ---------------------------------------------------------------------------

function normalize(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function matchCandidate(name, candidates) {
  const target = normalize(name);
  let m = candidates.find(c => normalize(c.name) === target);
  if (m) return { match: m, method: 'exact' };
  const parts = target.split(' ').filter(Boolean);
  const firstLast = parts.length >= 2 ? `${parts[0]} ${parts[parts.length - 1]}` : target;
  m = candidates.find(c => {
    const np = normalize(c.name).split(' ').filter(Boolean);
    const cFirstLast = np.length >= 2 ? `${np[0]} ${np[np.length - 1]}` : normalize(c.name);
    return cFirstLast === firstLast;
  });
  if (m) return { match: m, method: 'first-last' };
  m = candidates.find(c => {
    const cn = normalize(c.name);
    return target.includes(cn) || cn.includes(target);
  });
  if (m) return { match: m, method: 'substring' };
  return { match: null, method: 'none' };
}

/**
 * Apply a draft spec to a race: match draft candidate names to DB candidates by
 * name, build the final spec, and write it into every round of the race
 * (backing up any existing spec to ballot-spec.broken-<timestamp>.json).
 *
 * Inputs:
 *   - draftSpec:  the spec produced by extractDraftSpecFromPdf
 *   - raceId:     the DB race id
 *   - db:         the db module (with .query)
 *   - dryRun:     if true, build the plan but don't write anything
 *   - uploadsDir: override the uploads directory (default: server/../uploads)
 *
 * Returns:
 *   {
 *     race: { id, name, election_id, election_name },
 *     candidate_matches: [{ pdf_name, db: {id, name, status} | null, method }],
 *     unmatched_pdf_names: [...],
 *     missing_from_pdf: [{ id, name, status }],
 *     rounds_updated: [{ round_id, round_number, target, backup }],
 *     ok: true|false,
 *     error?: string,
 *   }
 */
async function applyDraftSpecToRace({ draftSpec, raceId, db, dryRun = false, uploadsDir }) {
  if (!draftSpec || !Array.isArray(draftSpec.candidates) || draftSpec.candidates.length === 0) {
    throw new Error('Draft spec has no candidates');
  }
  if (!draftSpec.qr_code) throw new Error('Draft spec has no qr_code');
  if (!draftSpec.ballot_size) throw new Error('Draft spec has no ballot_size');

  const { rows: raceRows } = await db.query('SELECT * FROM races WHERE id = $1', [raceId]);
  if (raceRows.length === 0) {
    return { ok: false, error: `Race ${raceId} not found` };
  }
  const race = raceRows[0];
  const { rows: electionRows } = await db.query('SELECT * FROM elections WHERE id = $1', [race.election_id]);
  const election = electionRows[0];

  const { rows: candidates } = await db.query(
    'SELECT id, name, display_order, status FROM candidates WHERE race_id = $1 ORDER BY display_order',
    [raceId]
  );
  if (candidates.length === 0) {
    return { ok: false, error: `Race ${raceId} has no candidates in DB` };
  }

  const candidateMatches = [];
  const usedIds = new Set();
  for (const dc of draftSpec.candidates) {
    const remaining = candidates.filter(c => !usedIds.has(c.id));
    const { match, method } = matchCandidate(dc.name, remaining);
    candidateMatches.push({
      pdf_name: dc.name,
      db: match ? { id: match.id, name: match.name, status: match.status, display_order: match.display_order } : null,
      method,
    });
    if (match) usedIds.add(match.id);
  }
  const unmatchedPdfNames = candidateMatches.filter(m => !m.db).map(m => m.pdf_name);
  const missingFromPdf = candidates
    .filter(c => !candidateMatches.some(m => m.db && m.db.id === c.id))
    .map(c => ({ id: c.id, name: c.name, status: c.status, display_order: c.display_order }));

  if (unmatchedPdfNames.length > 0) {
    return {
      ok: false,
      error: `Could not match ${unmatchedPdfNames.length} candidate name(s) from the PDF to DB candidates`,
      race: { id: race.id, name: race.name, election_id: race.election_id, election_name: election?.name },
      candidate_matches: candidateMatches,
      unmatched_pdf_names: unmatchedPdfNames,
      missing_from_pdf: missingFromPdf,
    };
  }

  const { rows: rounds } = await db.query(
    'SELECT id, round_number, status, paper_color FROM rounds WHERE race_id = $1 ORDER BY round_number',
    [raceId]
  );

  const specCandidates = candidateMatches.map((m, i) => ({
    candidate_id: m.db.id,
    name: m.db.name,
    oval: draftSpec.candidates[i].oval,
  }));

  const root = uploadsDir ? path.resolve(uploadsDir) : path.resolve(path.join(__dirname, '..', '..', '..', 'uploads'));
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const writes = [];
  for (const round of rounds) {
    const roundDir = path.join(root, 'elections', String(election.id), 'rounds', String(round.id));
    const specPath = path.join(roundDir, 'ballot-spec.json');

    const finalSpec = {
      election_id: election.id,
      race_id: race.id,
      round_id: round.id,
      ballot_size: draftSpec.ballot_size,
      dpi: draftSpec.dpi || 300,
      qr_code: draftSpec.qr_code,
      candidates: specCandidates,
      omr_thresholds: draftSpec.omr_thresholds || { marked: 0.20, unmarked: 0.10 },
      _recovery: {
        ...(draftSpec._recovery || {}),
        applied_at: new Date().toISOString(),
        from_race_id: race.id,
      },
    };

    const backupPath = fs.existsSync(specPath) ? path.join(roundDir, `ballot-spec.broken-${ts}.json`) : null;
    writes.push({ round, roundDir, specPath, backupPath, finalSpec });
  }

  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      race: { id: race.id, name: race.name, election_id: race.election_id, election_name: election?.name },
      candidate_matches: candidateMatches,
      unmatched_pdf_names: [],
      missing_from_pdf: missingFromPdf,
      rounds_to_update: writes.map(w => ({
        round_id: w.round.id,
        round_number: w.round.round_number,
        target: w.specPath,
        backup: w.backupPath,
      })),
    };
  }

  const updated = [];
  for (const w of writes) {
    fs.mkdirSync(w.roundDir, { recursive: true });
    if (w.backupPath) fs.copyFileSync(w.specPath, w.backupPath);
    fs.writeFileSync(w.specPath, JSON.stringify(w.finalSpec, null, 2));
    updated.push({
      round_id: w.round.id,
      round_number: w.round.round_number,
      target: w.specPath,
      backup: w.backupPath,
    });
  }

  // Append to recovery log
  const electionDir = path.join(root, 'elections', String(election.id));
  fs.mkdirSync(electionDir, { recursive: true });
  const logPath = path.join(electionDir, 'recovery-log.json');
  let existingLog = [];
  if (fs.existsSync(logPath)) {
    try { existingLog = JSON.parse(fs.readFileSync(logPath, 'utf8')); } catch { existingLog = []; }
    if (!Array.isArray(existingLog)) existingLog = [];
  }
  existingLog.push({
    timestamp: new Date().toISOString(),
    race_id: race.id,
    race_name: race.name,
    election_id: election.id,
    source_pdf: draftSpec._recovery?.source_pdf || null,
    candidate_match_method_summary: candidateMatches.reduce((acc, m) => {
      acc[m.method] = (acc[m.method] || 0) + 1;
      return acc;
    }, {}),
    rounds_updated: updated,
  });
  fs.writeFileSync(logPath, JSON.stringify(existingLog, null, 2));

  return {
    ok: true,
    race: { id: race.id, name: race.name, election_id: race.election_id, election_name: election?.name },
    candidate_matches: candidateMatches,
    unmatched_pdf_names: [],
    missing_from_pdf: missingFromPdf,
    rounds_updated: updated,
    recovery_log: logPath,
  };
}

/**
 * Convenience: extract from PDF buffer + apply to race in one call.
 * Used by the API "apply" endpoint.
 */
async function recoverAndApplyForRace({ pdfBuffer, sourceName, raceId, db, dryRun = false, uploadsDir, ballotSize, candidatesOverride }) {
  const { draftSpec, info } = await extractDraftSpecFromPdf({ pdfBuffer, sourceName, ballotSize, candidatesOverride });
  const apply = await applyDraftSpecToRace({ draftSpec, raceId, db, dryRun, uploadsDir });
  return { extraction: info, draft_spec: draftSpec, apply };
}

module.exports = {
  extractDraftSpecFromPdf,
  applyDraftSpecToRace,
  recoverAndApplyForRace,
  // exported for tests/CLI scripts that want raw helpers
  _internal: { readPdfPage1Drawing, isolateCell, findCandidateOvals, findQrImage, findCandidateNamesForOvals },
};
