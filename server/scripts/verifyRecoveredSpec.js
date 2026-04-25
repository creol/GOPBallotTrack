#!/usr/bin/env node
/**
 * Render a verification PDF showing where the recovered spec predicts the QR and
 * each oval-crop zone will be. The user opens this PDF and the source ballot PDF
 * side-by-side (or layers them in a PDF viewer / prints both at 100% and overlays
 * them physically) to confirm the red boxes land on the printed ovals.
 *
 * Page is Letter-sized to match the source PDF. Same 2x2 cell tiling for
 * quarter_letter so each printed ballot has its overlay in the matching position.
 *
 * Usage:
 *   node server/scripts/verifyRecoveredSpec.js \
 *     --draft-spec uploads/elections/12/recovery-source-pdfs/race-74.draft-spec.json \
 *     --out uploads/elections/12/recovery-source-pdfs/race-74.verify.pdf
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const LETTER_W = 612;
const LETTER_H = 792;
const PX_TO_PT = 72 / 300;

const SIZE_DIMS = {
  letter:         { w: 612,  h: 792, perPage: 1, cols: 1, rows: 1 },
  half_letter:    { w: 396,  h: 612, perPage: 2, cols: 1, rows: 2 },
  quarter_letter: { w: 306,  h: 396, perPage: 4, cols: 2, rows: 2 },
  eighth_letter:  { w: 198,  h: 306, perPage: 8, cols: 2, rows: 4 },
};

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--draft-spec') out.draftSpec = argv[++i];
    else if (a === '--out') out.out = argv[++i];
  }
  if (!out.draftSpec || !out.out) {
    console.error('Usage: node verifyRecoveredSpec.js --draft-spec <path> --out <path>');
    process.exit(1);
  }
  return out;
}

function pxToPt(px) { return px * PX_TO_PT; }

function drawCellOverlay(doc, ox, oy, cellW, cellH, spec) {
  // Cell border
  doc.save();
  doc.lineWidth(0.4).strokeColor('#bbbbbb');
  doc.rect(ox, oy, cellW, cellH).stroke();
  doc.restore();

  // QR — green box at predicted position (in pts, converted from spec px)
  const qr = spec.qr_code;
  const qrX = ox + pxToPt(qr.x);
  const qrY = oy + pxToPt(qr.y);
  const qrW = pxToPt(qr.width);
  const qrH = pxToPt(qr.height);
  doc.save();
  doc.lineWidth(1).strokeColor('#00aa00');
  doc.rect(qrX, qrY, qrW, qrH).stroke();
  doc.fontSize(6).fillColor('#00aa00');
  doc.text('QR', qrX, qrY - 8, { lineBreak: false });
  doc.restore();

  // Each oval crop zone — red box (matches omrService.js crop: 65% W x 70% H, shifted 15% left of center)
  for (const c of spec.candidates) {
    const ovalCx = ox + pxToPt(qr.x) + pxToPt(c.oval.x_offset_from_qr);
    const ovalCy = oy + pxToPt(qr.y) + pxToPt(c.oval.y_offset_from_qr);
    const fullW = pxToPt(c.oval.width);
    const fullH = pxToPt(c.oval.height);

    const shrinkW = 0.65;
    const shrinkH = 0.70;
    const cropW = fullW * shrinkW;
    const cropH = fullH * shrinkH;
    const shiftLeft = fullW * 0.15;
    const cropX = ovalCx - shiftLeft - cropW / 2;
    const cropY = ovalCy - cropH / 2;

    // Red crop zone (filled translucent)
    doc.save();
    doc.lineWidth(0.8).strokeColor('#ff0000');
    doc.rect(cropX, cropY, cropW, cropH).stroke();
    doc.fillColor('#ff0000').opacity(0.15);
    doc.rect(cropX, cropY, cropW, cropH).fill();
    doc.restore();

    // Full oval bounding box (blue thin)
    doc.save();
    doc.lineWidth(0.3).strokeColor('#0000ff');
    doc.rect(ovalCx - fullW / 2, ovalCy - fullH / 2, fullW, fullH).stroke();
    doc.restore();

    // Center crosshair (green)
    doc.save();
    doc.lineWidth(0.4).strokeColor('#00aa00');
    doc.moveTo(ovalCx - 3, ovalCy).lineTo(ovalCx + 3, ovalCy).stroke();
    doc.moveTo(ovalCx, ovalCy - 3).lineTo(ovalCx, ovalCy + 3).stroke();
    doc.restore();

    // Candidate name label to the right
    doc.save();
    doc.fontSize(6).fillColor('#000000');
    doc.text(c.name || '?', ovalCx + fullW / 2 + 4, ovalCy - 3, { width: cellW - (ovalCx - ox) - fullW / 2 - 8, lineBreak: false });
    doc.restore();
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const draft = JSON.parse(fs.readFileSync(path.resolve(args.draftSpec), 'utf8'));
  const dims = SIZE_DIMS[draft.ballot_size];
  if (!dims) throw new Error(`Unknown ballot_size: ${draft.ballot_size}`);

  // Resolve cell dimensions and grid placement on Letter page
  let cellW, cellH, padX, padY;
  if (draft.ballot_size === 'letter') {
    cellW = LETTER_W; cellH = LETTER_H; padX = 0; padY = 0;
  } else if (draft.ballot_size === 'eighth_letter') {
    cellW = 4.25 * 72; cellH = 2.75 * 72;
    padX = (LETTER_W - dims.cols * cellW) / 2;
    padY = (LETTER_H - dims.rows * cellH) / 2;
  } else {
    cellW = dims.w; cellH = dims.h;
    padX = (LETTER_W - dims.cols * cellW) / 2;
    padY = (LETTER_H - dims.rows * cellH) / 2;
  }

  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  const doc = new PDFDocument({ size: 'LETTER', margin: 0, autoFirstPage: false });
  const stream = fs.createWriteStream(path.resolve(args.out));
  doc.pipe(stream);
  doc.addPage({ size: 'LETTER', margin: 0 });

  // Header
  doc.save();
  doc.fontSize(8).fillColor('#000000');
  doc.text(`Verification overlay for: ${draft._recovery?.source_pdf || path.basename(args.draftSpec)}`, 10, 5, { lineBreak: false });
  doc.text(`ballot_size: ${draft.ballot_size}, ${draft.candidates.length} candidates  |  GREEN=QR, RED=OMR crop zone, BLUE=oval bbox`, 10, 14, { lineBreak: false });
  doc.restore();

  // Draw overlay in each cell
  for (let row = 0; row < dims.rows; row++) {
    for (let col = 0; col < dims.cols; col++) {
      const ox = padX + col * cellW;
      const oy = padY + row * cellH;
      drawCellOverlay(doc, ox, oy, cellW, cellH, draft);
    }
  }

  doc.end();
  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  console.log(`Verification PDF written: ${args.out}`);
  console.log('How to verify:');
  console.log('  1. Open this PDF and the source ballot PDF (page 1) in two windows side-by-side.');
  console.log('  2. Confirm: GREEN box covers the printed QR code in each cell.');
  console.log('  3. Confirm: RED box sits inside each printed candidate oval (and to the LEFT of name).');
  console.log('  4. Or: print this PDF at 100% scale and overlay it on a printed ballot, hold against a window.');
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
