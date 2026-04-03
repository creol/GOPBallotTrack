const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const db = require('../db');
const { generateSerials } = require('../services/serialGenerator');

// Ballot sizes in points (1 inch = 72 points)
const SIZES = {
  letter:        { width: 8.5 * 72,  height: 11 * 72,    label: 'Letter (8.5" x 11")' },
  half_letter:   { width: 5.5 * 72,  height: 8.5 * 72,   label: 'Half Letter (5.5" x 8.5")' },
  quarter_letter:{ width: 4.25 * 72, height: 5.5 * 72,   label: 'Quarter Letter (4.25" x 5.5")' },
  eighth_letter: { width: 2.75 * 72, height: 4.25 * 72,  label: '1/8 Letter (2.75" x 4.25")' },
};

/**
 * Fetch all data needed for ballot generation.
 */
async function fetchBallotData(roundId) {
  const { rows: [round] } = await db.query(
    'SELECT * FROM rounds WHERE id = $1', [roundId]
  );
  if (!round) throw new Error('Round not found');

  const { rows: [race] } = await db.query(
    'SELECT * FROM races WHERE id = $1', [round.race_id]
  );

  const { rows: [election] } = await db.query(
    'SELECT * FROM elections WHERE id = $1', [race.election_id]
  );

  const { rows: candidates } = await db.query(
    `SELECT * FROM candidates WHERE race_id = $1 AND status = 'active' ORDER BY display_order`,
    [round.race_id]
  );

  return { round, race, election, candidates };
}

/**
 * Generate a QR code as a data URL (PNG buffer).
 */
async function generateQR(data, size) {
  return QRCode.toBuffer(JSON.stringify(data), {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: size,
    color: { dark: '#000000', light: '#ffffff' },
  });
}

/**
 * Draw a single filled oval (example of correct mark).
 */
function drawFilledOval(doc, x, y, rx, ry) {
  doc.save();
  doc.ellipse(x, y, rx, ry).fill('#000');
  doc.restore();
}

/**
 * Draw an empty oval outline.
 */
function drawEmptyOval(doc, x, y, rx, ry) {
  doc.save();
  doc.lineWidth(1.5);
  doc.ellipse(x, y, rx, ry).stroke('#000');
  doc.restore();
}

/**
 * Draw a partial-fill oval (bad example).
 */
function drawPartialOval(doc, x, y, rx, ry) {
  doc.save();
  doc.lineWidth(1.5);
  doc.ellipse(x, y, rx, ry).stroke('#000');
  // partial fill - small filled area
  doc.ellipse(x, y, rx * 0.4, ry * 0.4).fill('#000');
  doc.restore();
}

/**
 * Draw a check mark inside an oval (bad example).
 */
function drawCheckOval(doc, x, y, rx, ry) {
  doc.save();
  doc.lineWidth(1.5);
  doc.ellipse(x, y, rx, ry).stroke('#000');
  // draw check mark
  doc.lineWidth(2);
  doc.moveTo(x - rx * 0.4, y)
     .lineTo(x - rx * 0.1, y + ry * 0.4)
     .lineTo(x + rx * 0.5, y - ry * 0.4)
     .stroke('#000');
  doc.restore();
}

/**
 * Draw an X inside an oval (bad example).
 */
function drawXOval(doc, x, y, rx, ry) {
  doc.save();
  doc.lineWidth(1.5);
  doc.ellipse(x, y, rx, ry).stroke('#000');
  // draw X
  doc.lineWidth(2);
  const off = Math.min(rx, ry) * 0.45;
  doc.moveTo(x - off, y - off).lineTo(x + off, y + off).stroke('#000');
  doc.moveTo(x + off, y - off).lineTo(x - off, y + off).stroke('#000');
  doc.restore();
}

/**
 * Render one ballot page.
 */
async function renderBallotPage(doc, { election, race, round, candidate, serialNumber, sizeKey, logoPath }) {
  const size = SIZES[sizeKey];
  const margin = Math.max(size.width * 0.06, 18);
  const contentWidth = size.width - margin * 2;
  const isSmall = sizeKey === 'eighth_letter';
  const isQuarter = sizeKey === 'quarter_letter';

  // Scale factors for smaller ballots
  const titleSize = isSmall ? 10 : isQuarter ? 12 : 16;
  const subtitleSize = isSmall ? 8 : isQuarter ? 10 : 12;
  const bodySize = isSmall ? 7 : isQuarter ? 9 : 11;
  const footerSize = isSmall ? 5.5 : isQuarter ? 6.5 : 8;
  const ovalRx = isSmall ? 6 : isQuarter ? 7 : 9;
  const ovalRy = isSmall ? 4 : isQuarter ? 5 : 6;
  const lineHeight = isSmall ? 14 : isQuarter ? 18 : 24;
  const qrSize = isSmall ? 50 : isQuarter ? 65 : 90;

  let y = margin;

  // === HEADER ===
  // Logo (if provided)
  if (logoPath && fs.existsSync(logoPath)) {
    const logoSize = isSmall ? 24 : isQuarter ? 32 : 48;
    doc.image(logoPath, margin, y, { width: logoSize, height: logoSize });
    // Title next to logo
    doc.fontSize(titleSize).font('Helvetica-Bold');
    doc.text(election.name, margin + (isSmall ? 28 : isQuarter ? 38 : 56), y, { width: contentWidth - 60 });
    y += logoSize + 4;
  } else {
    doc.fontSize(titleSize).font('Helvetica-Bold');
    doc.text(election.name, margin, y, { width: contentWidth, align: 'center' });
    y += titleSize + 6;
  }

  // Race name
  doc.fontSize(subtitleSize).font('Helvetica-Bold');
  doc.text(race.name, margin, y, { width: contentWidth, align: 'center' });
  y += subtitleSize + 4;

  // Round info
  doc.fontSize(bodySize).font('Helvetica');
  doc.text(`Round ${round.round_number}`, margin, y, { width: contentWidth, align: 'center' });
  y += bodySize + 8;

  // Divider line
  doc.lineWidth(0.5);
  doc.moveTo(margin, y).lineTo(size.width - margin, y).stroke('#000');
  y += 8;

  // === BODY: Candidates with ovals ===
  doc.font('Helvetica');
  for (const c of candidate) {
    const ovalX = margin + ovalRx + 4;
    const ovalY = y + lineHeight / 2;
    drawEmptyOval(doc, ovalX, ovalY, ovalRx, ovalRy);
    doc.fontSize(bodySize);
    doc.text(c.name, margin + ovalRx * 2 + 14, y + (lineHeight - bodySize) / 2, { width: contentWidth - ovalRx * 2 - 20 });
    y += lineHeight;
  }

  y += 6;

  // Divider
  doc.lineWidth(0.5);
  doc.moveTo(margin, y).lineTo(size.width - margin, y).stroke('#000');
  y += 6;

  // === FOOTER ===
  doc.fontSize(footerSize).font('Helvetica-Bold');
  doc.text('Do NOT bend. Completely fill the oval of your vote.', margin, y, { width: contentWidth, align: 'center' });
  y += footerSize + 4;

  doc.fontSize(footerSize).font('Helvetica');
  doc.text('You are encouraged to take a photo of your completed ballot before submitting for your validation.', margin, y, { width: contentWidth, align: 'center' });
  y += footerSize * 2 + 6;

  // Visual examples
  const exampleOvalRx = isSmall ? 5 : isQuarter ? 6 : 8;
  const exampleOvalRy = isSmall ? 3.5 : isQuarter ? 4 : 5.5;
  const exGap = contentWidth / 4;
  const exY = y + exampleOvalRy + 2;
  const labelY = exY + exampleOvalRy + 4;

  // Good example
  const exX1 = margin + exGap * 0.5;
  drawFilledOval(doc, exX1, exY, exampleOvalRx, exampleOvalRy);
  doc.fontSize(footerSize - 1).font('Helvetica');
  doc.text('CORRECT', exX1 - 20, labelY, { width: 40, align: 'center' });

  // Bad: partial fill
  const exX2 = margin + exGap * 1.5;
  drawPartialOval(doc, exX2, exY, exampleOvalRx, exampleOvalRy);
  doc.text('WRONG', exX2 - 20, labelY, { width: 40, align: 'center' });

  // Bad: check mark
  const exX3 = margin + exGap * 2.5;
  drawCheckOval(doc, exX3, exY, exampleOvalRx, exampleOvalRy);
  doc.text('WRONG', exX3 - 20, labelY, { width: 40, align: 'center' });

  // Bad: X mark
  const exX4 = margin + exGap * 3.5;
  drawXOval(doc, exX4, exY, exampleOvalRx, exampleOvalRy);
  doc.text('WRONG', exX4 - 20, labelY, { width: 40, align: 'center' });

  y = labelY + footerSize + 8;

  // === QR CODE + SN ===
  // Position QR at bottom-right to avoid interfering with candidate area
  const qrData = { sn: serialNumber, round_id: round.id, race_id: race.id };
  const qrBuffer = await generateQR(qrData, qrSize);

  const qrX = size.width - margin - qrSize;
  const qrY = size.height - margin - qrSize - (isSmall ? 10 : 14);

  doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize });

  // SN text below QR
  doc.fontSize(isSmall ? 5.5 : isQuarter ? 7 : 9).font('Courier-Bold');
  doc.text(serialNumber, qrX, qrY + qrSize + 2, { width: qrSize, align: 'center' });
}

/**
 * Generate ballot PDF and data ZIP for a round.
 * Returns { pdfPath, zipPath, serials }
 */
async function generateBallots({ roundId, quantity, sizeKey, logoPath }) {
  if (!SIZES[sizeKey]) throw new Error(`Invalid size: ${sizeKey}`);

  const data = await fetchBallotData(roundId);
  const { round, race, election, candidates } = data;

  // Generate serial numbers
  const serials = await generateSerials(roundId, quantity);

  // Ensure output directory
  const outDir = path.join(__dirname, '..', '..', '..', 'uploads', 'elections', String(election.id), 'rounds', String(roundId));
  fs.mkdirSync(outDir, { recursive: true });

  const pdfPath = path.join(outDir, 'ballots.pdf');
  const zipPath = path.join(outDir, 'ballot-data.zip');

  // === Generate PDF ===
  const size = SIZES[sizeKey];
  const doc = new PDFDocument({
    size: [size.width, size.height],
    margin: 0,
    autoFirstPage: false,
  });

  const pdfStream = fs.createWriteStream(pdfPath);
  doc.pipe(pdfStream);

  for (const serial of serials) {
    doc.addPage({ size: [size.width, size.height], margin: 0 });
    await renderBallotPage(doc, {
      election,
      race,
      round,
      candidate: candidates,
      serialNumber: serial.serial_number,
      sizeKey,
      logoPath,
    });
  }

  doc.end();
  await new Promise((resolve, reject) => {
    pdfStream.on('finish', resolve);
    pdfStream.on('error', reject);
  });

  // === Generate ZIP (metadata only, no PDF) ===
  const metadata = {
    election: { id: election.id, name: election.name, date: election.date },
    race: { id: race.id, name: race.name },
    round: { id: round.id, number: round.round_number, paper_color: round.paper_color },
    ballot_size: SIZES[sizeKey].label,
    generated_at: new Date().toISOString(),
    quantity,
    serial_numbers: serials.map(s => s.serial_number),
  };

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    archive.append(JSON.stringify(metadata, null, 2), { name: 'ballot-data.json' });
    archive.finalize();
  });

  return { pdfPath, zipPath, serials, outDir };
}

module.exports = { generateBallots, SIZES };
