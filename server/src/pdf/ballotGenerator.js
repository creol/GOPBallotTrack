const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const db = require('../db');
const { generateSerials } = require('../services/serialGenerator');
const { DEFAULT_CONFIG } = require('../routes/ballotDesign');

// Ballot sizes in points (1 inch = 72 points)
const LETTER_W = 8.5 * 72;
const LETTER_H = 11 * 72;
const DPI = 300;
const PTS_TO_PX = DPI / 72; // 1 pt = 300/72 px at 300 DPI

const SIZES = {
  letter:        { width: 8.5 * 72,  height: 11 * 72,   label: 'Letter (8.5" x 11")',           perPage: 1, cols: 1, rows: 1 },
  half_letter:   { width: 5.5 * 72,  height: 8.5 * 72,  label: 'Half Letter (5.5" x 8.5")',     perPage: 2, cols: 1, rows: 2 },
  quarter_letter:{ width: 4.25 * 72, height: 5.5 * 72,  label: 'Quarter Letter (4.25" x 5.5")', perPage: 4, cols: 2, rows: 2 },
  eighth_letter: { width: 2.75 * 72, height: 4.25 * 72, label: '1/8 Letter (2.75" x 4.25")',    perPage: 8, cols: 2, rows: 4 },
};

/**
 * Fetch all data needed for ballot generation.
 */
async function fetchBallotData(roundId) {
  const { rows: [round] } = await db.query('SELECT * FROM rounds WHERE id = $1', [roundId]);
  if (!round) throw new Error('Round not found');
  const { rows: [race] } = await db.query('SELECT * FROM races WHERE id = $1', [round.race_id]);
  const { rows: [election] } = await db.query('SELECT * FROM elections WHERE id = $1', [race.election_id]);
  const { rows: candidates } = await db.query(
    `SELECT * FROM candidates WHERE race_id = $1 AND status = 'active' ORDER BY display_order`,
    [round.race_id]
  );
  return { round, race, election, candidates };
}

/**
 * Load design config for an election, merged with defaults and per-round overrides.
 */
async function loadDesignConfig(electionId, roundId) {
  const { rows: [design] } = await db.query(
    'SELECT config FROM ballot_designs WHERE election_id = $1', [electionId]
  );
  const base = {};
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    base[key] = { ...DEFAULT_CONFIG[key], ...(design?.config?.[key] || {}) };
  }

  // Merge per-round overrides if they exist
  if (roundId) {
    const { rows: [round] } = await db.query(
      'SELECT ballot_design_overrides FROM rounds WHERE id = $1', [roundId]
    );
    if (round?.ballot_design_overrides) {
      for (const key of Object.keys(round.ballot_design_overrides)) {
        if (base[key]) {
          base[key] = { ...base[key], ...round.ballot_design_overrides[key] };
        } else {
          base[key] = round.ballot_design_overrides[key];
        }
      }
    }
  }

  return base;
}

async function generateQR(data, size) {
  // Encode as plain string (not JSON) for simpler, more readable QR codes
  const payload = typeof data === 'string' ? data : String(data);
  return QRCode.toBuffer(payload, {
    errorCorrectionLevel: 'M', margin: 1, width: size,
    color: { dark: '#000000', light: '#ffffff' },
  });
}

// === Oval drawing helpers ===
function drawFilledOval(doc, x, y, rx, ry) {
  doc.save(); doc.ellipse(x, y, rx, ry).fill('#000'); doc.restore();
}
function drawEmptyOval(doc, x, y, rx, ry) {
  doc.save(); doc.lineWidth(1.5); doc.ellipse(x, y, rx, ry).stroke('#000'); doc.restore();
}
function drawPartialOval(doc, x, y, rx, ry) {
  doc.save(); doc.lineWidth(1.5); doc.ellipse(x, y, rx, ry).stroke('#000');
  doc.ellipse(x, y, rx * 0.4, ry * 0.4).fill('#000'); doc.restore();
}
function drawCheckOval(doc, x, y, rx, ry) {
  doc.save(); doc.lineWidth(1.5); doc.ellipse(x, y, rx, ry).stroke('#000');
  doc.lineWidth(2);
  doc.moveTo(x - rx * 0.4, y).lineTo(x - rx * 0.1, y + ry * 0.4).lineTo(x + rx * 0.5, y - ry * 0.4).stroke('#000');
  doc.restore();
}
function drawXOval(doc, x, y, rx, ry) {
  doc.save(); doc.lineWidth(1.5); doc.ellipse(x, y, rx, ry).stroke('#000');
  doc.lineWidth(2);
  const off = Math.min(rx, ry) * 0.45;
  doc.moveTo(x - off, y - off).lineTo(x + off, y + off).stroke('#000');
  doc.moveTo(x + off, y - off).lineTo(x - off, y + off).stroke('#000');
  doc.restore();
}

/**
 * Compute scale factors based on ballot size.
 */
function getScale(sizeKey, cfg) {
  const isSmall = sizeKey === 'eighth_letter';
  const isQuarter = sizeKey === 'quarter_letter';
  const isHalf = sizeKey === 'half_letter';

  const spacingMult = cfg.candidates.spacing === 'compact' ? 0.8 : cfg.candidates.spacing === 'spacious' ? 1.3 : 1;
  const ovalMult = cfg.candidates.ovalSize === 'small' ? 0.75 : cfg.candidates.ovalSize === 'large' ? 1.25 : 1;

  return {
    titleSize:    isSmall ? 10 : isQuarter ? 12 : isHalf ? 14 : cfg.header.electionNameSize,
    subtitleSize: isSmall ? 8  : isQuarter ? 10 : isHalf ? 12 : cfg.header.raceNameSize,
    bodySize:     isSmall ? 7  : isQuarter ? 9  : isHalf ? 10 : cfg.candidates.fontSize,
    footerSize:   isSmall ? 5.5 : isQuarter ? 6.5 : isHalf ? 7 : cfg.instructions.fontSize,
    ovalRx:       (isSmall ? 6 : isQuarter ? 7 : 9) * ovalMult,
    ovalRy:       (isSmall ? 4 : isQuarter ? 5 : 6) * ovalMult,
    lineHeight:   (isSmall ? 14 : isQuarter ? 18 : 24) * spacingMult,
    qrSize:       isSmall ? 50 : isQuarter ? 65 : isHalf ? 80 : 90,
  };
}

/**
 * Find the logo file for an election from the uploads directory.
 */
function findElectionLogo(electionId) {
  const dir = path.join(__dirname, '..', '..', '..', 'uploads', 'elections', String(electionId), 'logos');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(f));
  return files.length > 0 ? path.join(dir, files[0]) : null;
}

/**
 * Convert PDFKit points to 300 DPI pixels.
 */
function ptToPx(pt) {
  return Math.round(pt * PTS_TO_PX);
}

/**
 * Render one ballot within a region and return OMR zone positions.
 * ox, oy = origin offset on the page. bw, bh = ballot dimensions.
 * Returns { qr: {x,y,w,h in pts}, ovals: [{candidateId, cx, cy, rx, ry in pts}] }
 */
async function renderBallot(doc, ox, oy, bw, bh, { election, race, round, candidates, serialNumber, sizeKey, logoPath, cfg }) {
  const margin = Math.max(bw * 0.06, 14);
  const contentWidth = bw - margin * 2;
  const sc = getScale(sizeKey, cfg);

  // Resolve logo: explicit path > election's uploaded logo
  const resolvedLogo = logoPath || findElectionLogo(election.id);

  // Track positions for ballot-spec
  const ovalPositions = [];
  let qrPosition = null;

  let y = oy + margin;
  const left = ox + margin;

  // === HEADER ===
  if (cfg.header.show) {
    if (cfg.logo.show && resolvedLogo && fs.existsSync(resolvedLogo)) {
      const logoW = Math.min(cfg.logo.maxWidth, bw * 0.15);
      const logoX = cfg.logo.position === 'top-right' ? ox + bw - margin - logoW
        : cfg.logo.position === 'top-center' ? ox + (bw - logoW) / 2
        : left;
      doc.image(resolvedLogo, logoX, y, { width: logoW, height: logoW });
      if (cfg.logo.position !== 'top-center') {
        const textX = cfg.logo.position === 'top-left' ? left + logoW + 6 : left;
        const textW = cfg.logo.position === 'top-left' ? contentWidth - logoW - 6 : contentWidth - logoW - 6;
        doc.fontSize(sc.titleSize).font('Helvetica-Bold');
        doc.text(election.name, textX, y, { width: textW });
        y += logoW + 4;
      } else {
        y += logoW + 4;
        doc.fontSize(sc.titleSize).font('Helvetica-Bold');
        doc.text(election.name, left, y, { width: contentWidth, align: 'center' });
        y += sc.titleSize + 6;
      }
    } else {
      doc.fontSize(sc.titleSize).font('Helvetica-Bold');
      doc.text(election.name, left, y, { width: contentWidth, align: 'center' });
      y += sc.titleSize + 6;
    }

    doc.fontSize(sc.subtitleSize).font('Helvetica-Bold');
    doc.text(race.name, left, y, { width: contentWidth, align: 'center' });
    y += sc.subtitleSize + 4;

    doc.fontSize(sc.bodySize).font('Helvetica');
    doc.text(`Round ${round.round_number}`, left, y, { width: contentWidth, align: 'center' });
    y += sc.bodySize + 6;
  }

  // Divider
  doc.lineWidth(0.5).moveTo(left, y).lineTo(left + contentWidth, y).stroke('#000');
  y += 6;

  // === CANDIDATES (auto-placed) ===
  doc.font('Helvetica');
  for (const c of candidates) {
    const ovalX = left + sc.ovalRx + 4;
    const ovalY = y + sc.lineHeight / 2;
    drawEmptyOval(doc, ovalX, ovalY, sc.ovalRx, sc.ovalRy);
    doc.fontSize(sc.bodySize);
    doc.text(c.name, left + sc.ovalRx * 2 + 14, y + (sc.lineHeight - sc.bodySize) / 2, { width: contentWidth - sc.ovalRx * 2 - 20 });

    // Track oval position (center + radii, relative to ballot origin)
    ovalPositions.push({
      candidateId: c.id,
      candidateName: c.name,
      cx: ovalX - ox,
      cy: ovalY - oy,
      rx: sc.ovalRx,
      ry: sc.ovalRy,
    });

    y += sc.lineHeight;
  }
  y += 4;

  // Divider
  doc.lineWidth(0.5).moveTo(left, y).lineTo(left + contentWidth, y).stroke('#000');
  y += 5;

  // === INSTRUCTIONS ===
  if (cfg.instructions.show) {
    doc.fontSize(sc.footerSize).font('Helvetica-Bold');
    doc.text(cfg.instructions.text, left, y, { width: contentWidth, align: 'center' });
    y += sc.footerSize + 3;
  }

  if (cfg.encouragement.show) {
    doc.fontSize(sc.footerSize).font('Helvetica');
    doc.text(cfg.encouragement.text, left, y, { width: contentWidth, align: 'center' });
    y += sc.footerSize * 2 + 4;
  }

  // === EXAMPLES ===
  if (cfg.examples.show) {
    const exRx = sc.footerSize * 0.9;
    const exRy = sc.footerSize * 0.65;
    const exGap = contentWidth / 4;
    const exY = y + exRy + 2;
    const labelY = exY + exRy + 3;

    drawFilledOval(doc, left + exGap * 0.5, exY, exRx, exRy);
    doc.fontSize(sc.footerSize - 1).font('Helvetica');
    doc.text('CORRECT', left + exGap * 0.5 - 20, labelY, { width: 40, align: 'center' });

    drawPartialOval(doc, left + exGap * 1.5, exY, exRx, exRy);
    doc.text('WRONG', left + exGap * 1.5 - 20, labelY, { width: 40, align: 'center' });

    drawCheckOval(doc, left + exGap * 2.5, exY, exRx, exRy);
    doc.text('WRONG', left + exGap * 2.5 - 20, labelY, { width: 40, align: 'center' });

    drawXOval(doc, left + exGap * 3.5, exY, exRx, exRy);
    doc.text('WRONG', left + exGap * 3.5 - 20, labelY, { width: 40, align: 'center' });

    y = labelY + sc.footerSize + 4;
  }

  // === CUSTOM NOTES ===
  if (cfg.notes.show && cfg.notes.text) {
    doc.fontSize(sc.footerSize).font('Helvetica-Oblique');
    doc.text(cfg.notes.text, left, y, { width: contentWidth, align: 'center' });
    y += sc.footerSize + 4;
  }

  // === SINGLE QR CODE (bottom-right) + SN below ===
  if (cfg.qr.show) {
    const qrBuffer = await generateQR(serialNumber, sc.qrSize);

    const qrX = ox + bw - margin - sc.qrSize;
    const qrY = oy + bh - margin - sc.qrSize - (sizeKey === 'eighth_letter' ? 8 : 12);
    doc.image(qrBuffer, qrX, qrY, { width: sc.qrSize, height: sc.qrSize });

    qrPosition = {
      x: qrX - ox,
      y: qrY - oy,
      width: sc.qrSize,
      height: sc.qrSize,
    };

    if (cfg.sn.show) {
      const snSize = sizeKey === 'eighth_letter' ? 5.5 : sizeKey === 'quarter_letter' ? 7 : 9;
      doc.fontSize(snSize).font('Courier-Bold');
      doc.text(serialNumber, qrX, qrY + sc.qrSize + 2, { width: sc.qrSize, align: 'center' });
    }
  } else if (cfg.sn.show) {
    const snSize = sizeKey === 'eighth_letter' ? 5.5 : sizeKey === 'quarter_letter' ? 7 : 9;
    doc.fontSize(snSize).font('Courier-Bold');
    doc.text(serialNumber, left, oy + bh - margin - snSize - 4, { width: contentWidth, align: 'center' });
  }

  // No back side — nothing printed on back

  return { qrPosition, ovalPositions };
}

/**
 * Build the ballot-spec.json OMR zone map from rendered positions.
 */
function buildBallotSpec({ election, race, round, sizeKey, qrPosition, ovalPositions }) {
  const spec = {
    election_id: election.id,
    race_id: race.id,
    round_id: round.id,
    ballot_size: sizeKey,
    dpi: DPI,
    qr_code: qrPosition ? {
      corner: 'bottom-right',
      encoding: 'plain_serial_number',
      x: ptToPx(qrPosition.x),
      y: ptToPx(qrPosition.y),
      width: ptToPx(qrPosition.width),
      height: ptToPx(qrPosition.height),
    } : null,
    candidates: ovalPositions.map(o => ({
      candidate_id: o.candidateId,
      name: o.candidateName,
      oval: {
        // Offsets from QR code position for ADF alignment
        x_offset_from_qr: qrPosition ? ptToPx(o.cx - qrPosition.x) : ptToPx(o.cx),
        y_offset_from_qr: qrPosition ? ptToPx(o.cy - qrPosition.y) : ptToPx(o.cy),
        // Absolute position on ballot (from ballot top-left corner)
        x: ptToPx(o.cx - o.rx),
        y: ptToPx(o.cy - o.ry),
        width: ptToPx(o.rx * 2),
        height: ptToPx(o.ry * 2),
      },
    })),
    omr_thresholds: {
      // With inner-65% crop, the oval outline is excluded.
      // Empty inner area: ~0.02-0.06 (just paper noise)
      // Filled inner area: ~0.40+ (dark pencil/pen fill)
      marked: 0.20,    // clearly filled by voter
      unmarked: 0.10,  // empty (just paper noise, no mark)
    },
  };
  return spec;
}

/**
 * Generate ballot PDF (multi-up on letter pages), ballot-spec.json, and data ZIP.
 */
async function generateBallots({ roundId, quantity, sizeKey, logoPath }) {
  if (!SIZES[sizeKey]) throw new Error(`Invalid size: ${sizeKey}`);

  const data = await fetchBallotData(roundId);
  const { round, race, election, candidates } = data;
  const cfg = await loadDesignConfig(election.id, roundId);

  // Use existing SNs if they exist (pre-generated at race/round creation).
  // Only generate new ones if none exist (backward compat).
  const { rows: existingSerials } = await db.query(
    'SELECT * FROM ballot_serials WHERE round_id = $1 ORDER BY id', [roundId]
  );

  let serials;
  if (existingSerials.length > 0) {
    serials = existingSerials;
  } else if (quantity) {
    serials = await generateSerials(roundId, quantity);
  } else {
    throw new Error('No serial numbers exist for this round. Set ballot count on the race or provide a quantity.');
  }

  const outDir = path.join(__dirname, '..', '..', '..', 'uploads', 'elections', String(election.id), 'rounds', String(roundId));
  fs.mkdirSync(outDir, { recursive: true });

  const pdfPath = path.join(outDir, 'ballots.pdf');
  const zipPath = path.join(outDir, 'ballot-data.zip');
  const specPath = path.join(outDir, 'ballot-spec.json');

  const size = SIZES[sizeKey];
  const { perPage, cols, rows } = size;

  const isEighth = sizeKey === 'eighth_letter';
  const cellW = isEighth ? (4.25 * 72) : size.width;
  const cellH = isEighth ? (2.75 * 72) : size.height;

  const gridW = cols * cellW;
  const gridH = rows * cellH;
  const padX = (LETTER_W - gridW) / 2;
  const padY = (LETTER_H - gridH) / 2;

  // PDF is always letter-size for printing
  const doc = new PDFDocument({ size: 'LETTER', margin: 0, autoFirstPage: false });
  const pdfStream = fs.createWriteStream(pdfPath);
  doc.pipe(pdfStream);

  // Capture zone positions from first ballot rendered (all ballots have same layout)
  let specPositions = null;

  if (sizeKey === 'letter') {
    for (const serial of serials) {
      doc.addPage({ size: 'LETTER', margin: 0 });
      const positions = await renderBallot(doc, 0, 0, size.width, size.height, {
        election, race, round, candidates,
        serialNumber: serial.serial_number, sizeKey, logoPath, cfg,
      });
      if (!specPositions) specPositions = positions;
    }
  } else {
    let slotIndex = 0;

    for (const serial of serials) {
      if (slotIndex % perPage === 0) {
        doc.addPage({ size: 'LETTER', margin: 0 });
      }

      const posOnPage = slotIndex % perPage;
      const col = posOnPage % cols;
      const row = Math.floor(posOnPage / cols);

      const ox = padX + col * cellW;
      const oy = padY + row * cellH;

      const ballotW = isEighth ? cellW : size.width;
      const ballotH = isEighth ? cellH : size.height;

      const positions = await renderBallot(doc, ox, oy, ballotW, ballotH, {
        election, race, round, candidates,
        serialNumber: serial.serial_number, sizeKey, logoPath, cfg,
      });
      if (!specPositions) specPositions = positions;

      // Draw light cut guide border
      if (perPage > 1) {
        doc.save();
        doc.lineWidth(0.25).strokeColor('#ccc');
        doc.rect(ox, oy, ballotW, ballotH).stroke();
        doc.restore();
        doc.strokeColor('#000');
      }

      slotIndex++;
    }
  }

  doc.end();
  await new Promise((resolve, reject) => {
    pdfStream.on('finish', resolve);
    pdfStream.on('error', reject);
  });

  // === Generate ballot-spec.json ===
  const ballotSpec = buildBallotSpec({
    election, race, round, sizeKey,
    qrPosition: specPositions?.qrPosition || null,
    ovalPositions: specPositions?.ovalPositions || [],
  });
  fs.writeFileSync(specPath, JSON.stringify(ballotSpec, null, 2));

  // === Generate ZIP (metadata + ballot-spec) ===
  const metadata = {
    election: { id: election.id, name: election.name, date: election.date },
    race: { id: race.id, name: race.name },
    round: { id: round.id, number: round.round_number, paper_color: round.paper_color },
    ballot_size: SIZES[sizeKey].label,
    ballots_per_page: perPage,
    generated_at: new Date().toISOString(),
    quantity: serials.length,
    serial_numbers: serials.map(s => s.serial_number),
  };

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.append(JSON.stringify(metadata, null, 2), { name: 'ballot-data.json' });
    archive.append(JSON.stringify(ballotSpec, null, 2), { name: 'ballot-spec.json' });
    archive.finalize();
  });

  return { pdfPath, zipPath, serials, outDir };
}

/**
 * Generate a preview PDF (using existing serial numbers, no new ones created).
 * Fills one letter page with as many ballots as the size allows.
 */
async function generatePreviewPdf({ roundId, sizeKey, serialNumbers, outputPath }) {
  const data = await fetchBallotData(roundId);
  const { round, race, election, candidates } = data;
  const cfg = await loadDesignConfig(election.id, roundId);
  const size = SIZES[sizeKey];
  const { perPage, cols, rows } = size;

  const isEighth = sizeKey === 'eighth_letter';
  const cellW = isEighth ? (4.25 * 72) : size.width;
  const cellH = isEighth ? (2.75 * 72) : size.height;
  const gridW = cols * cellW;
  const gridH = rows * cellH;
  const padX = (LETTER_W - gridW) / 2;
  const padY = (LETTER_H - gridH) / 2;

  const doc = new PDFDocument({ size: 'LETTER', margin: 0, autoFirstPage: false });
  const stream = fs.createWriteStream(outputPath);
  doc.pipe(stream);

  if (sizeKey === 'letter') {
    doc.addPage({ size: 'LETTER', margin: 0 });
    await renderBallot(doc, 0, 0, size.width, size.height, {
      election, race, round, candidates,
      serialNumber: serialNumbers[0] || 'PREVIEW1', sizeKey, logoPath: null, cfg,
    });
  } else {
    doc.addPage({ size: 'LETTER', margin: 0 });
    for (let i = 0; i < perPage; i++) {
      const sn = serialNumbers[i % serialNumbers.length] || `PREV${i + 1}`;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const ox = padX + col * cellW;
      const oy = padY + row * cellH;
      const ballotW = isEighth ? cellW : size.width;
      const ballotH = isEighth ? cellH : size.height;

      await renderBallot(doc, ox, oy, ballotW, ballotH, {
        election, race, round, candidates,
        serialNumber: sn, sizeKey, logoPath: null, cfg,
      });

      if (perPage > 1) {
        doc.save();
        doc.lineWidth(0.25).strokeColor('#ccc');
        doc.rect(ox, oy, ballotW, ballotH).stroke();
        doc.restore();
        doc.strokeColor('#000');
      }
    }
  }

  doc.end();
  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

/**
 * Generate a calibration PDF that shows OMR crop zones as colored overlays.
 * Red rectangle = current OMR crop zone (what the scanner actually samples)
 * Blue rectangle = full oval bounding box from spec
 * Green crosshair = oval center point
 */
async function generateCalibrationPdf({ roundId, outputPath }) {
  const data = await fetchBallotData(roundId);
  const { round, race, election, candidates } = data;
  const cfg = await loadDesignConfig(election.id, roundId);
  const sizeKey = 'quarter_letter'; // Use whatever size was last generated
  const size = SIZES[sizeKey];

  // Load the ballot spec to get oval positions
  const specPath = path.join(__dirname, '..', '..', '..', 'uploads', 'elections', String(election.id), 'rounds', String(roundId), 'ballot-spec.json');
  let ballotSpec = null;
  if (fs.existsSync(specPath)) {
    ballotSpec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  }

  const doc = new PDFDocument({ size: 'LETTER', margin: 0, autoFirstPage: false });
  const stream = fs.createWriteStream(outputPath);
  doc.pipe(stream);

  doc.addPage({ size: 'LETTER', margin: 0 });

  // Render a normal ballot first
  const sn = 'CALIBRATE';
  const positions = await renderBallot(doc, 0, 0, size.width, size.height, {
    election, race, round, candidates,
    serialNumber: sn, sizeKey, logoPath: null, cfg,
  });

  // Now overlay the OMR crop zones
  if (positions && positions.ovalPositions && positions.qrPosition) {
    const qrCx = positions.qrPosition.x + positions.qrPosition.width / 2;
    const qrCy = positions.qrPosition.y + positions.qrPosition.height / 2;

    // Draw BR QR bounding box in green
    doc.save();
    doc.lineWidth(1).strokeColor('#00aa00');
    doc.rect(positions.qrPosition.x, positions.qrPosition.y, positions.qrPosition.width, positions.qrPosition.height).stroke();
    doc.fontSize(6).fillColor('#00aa00').text('BR QR', positions.qrPosition.x, positions.qrPosition.y - 8);
    doc.restore();


    for (const oval of positions.ovalPositions) {
      // Full oval bounding box (blue)
      const fullX = oval.cx - oval.rx;
      const fullY = oval.cy - oval.ry;
      const fullW = oval.rx * 2;
      const fullH = oval.ry * 2;

      doc.save();
      doc.lineWidth(0.5).strokeColor('#0000ff');
      doc.rect(fullX, fullY, fullW, fullH).stroke();
      doc.restore();

      // OMR crop zone (red) — matches the shrink + left-shift in omrService.js
      const shrinkW = 0.55;
      const shrinkH = 0.60;
      const cropW = fullW * shrinkW;
      const cropH = fullH * shrinkH;
      const shiftLeft = fullW * 0.15;
      const cropX = oval.cx - shiftLeft - cropW / 2;
      const cropY = oval.cy - cropH / 2;

      doc.save();
      doc.lineWidth(1.5).strokeColor('#ff0000');
      doc.rect(cropX, cropY, cropW, cropH).stroke();
      // Semi-transparent red fill
      doc.fillColor('#ff0000').opacity(0.1);
      doc.rect(cropX, cropY, cropW, cropH).fill();
      doc.restore();

      // Center crosshair (green)
      doc.save();
      doc.lineWidth(0.5).strokeColor('#00aa00');
      doc.moveTo(oval.cx - 3, oval.cy).lineTo(oval.cx + 3, oval.cy).stroke();
      doc.moveTo(oval.cx, oval.cy - 3).lineTo(oval.cx, oval.cy + 3).stroke();
      doc.restore();

      // Label
      doc.save();
      doc.fontSize(5).fillColor('#ff0000');
      doc.text(`CROP ${Math.round(cropW)}x${Math.round(cropH)}`, cropX, cropY - 7);
      doc.restore();
    }

    // Legend
    doc.save();
    doc.fontSize(7).fillColor('#000');
    const ly = size.height - 30;
    doc.fillColor('#ff0000').text('RED = OMR crop zone (what scanner samples)', 10, ly);
    doc.fillColor('#0000ff').text('BLUE = full oval bounding box', 10, ly + 9);
    doc.fillColor('#00aa00').text('GREEN = oval center + QR zone', 10, ly + 18);
    doc.restore();
  }

  doc.end();
  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

/**
 * Render a single ballot to a PDF file for a specific serial number.
 * Returns the path to the generated PDF.
 */
async function renderSingleBallotPdf({ roundId, serialNumber, outputPath, sizeKey: overrideSizeKey }) {
  const data = await fetchBallotData(roundId);
  const { round, race, election, candidates } = data;
  const cfg = await loadDesignConfig(election.id, roundId);

  const sizeKey = overrideSizeKey || cfg.lastBallotSize || 'quarter_letter';
  const size = SIZES[sizeKey];
  if (!size) throw new Error(`Invalid size: ${sizeKey}`);

  const PDFDocument = require('pdfkit');
  const fs = require('fs');

  const doc = new PDFDocument({ size: [size.width, size.height], margin: 0 });
  const stream = fs.createWriteStream(outputPath);
  doc.pipe(stream);

  await renderBallot(doc, 0, 0, size.width, size.height, {
    election, race, round, candidates, serialNumber, sizeKey, logoPath: null, cfg,
  });

  doc.end();
  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return outputPath;
}

module.exports = { generateBallots, generatePreviewPdf, generateCalibrationPdf, renderSingleBallotPdf, SIZES };
