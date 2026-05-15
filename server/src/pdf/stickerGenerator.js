// stickerGenerator.js — print-ready QR voter-token sticker sheets
// (Prompt H, stage H2).
//
// Renders a batch of tokens as a grid of QR-code stickers, one PDF, laid out
// for either standard Avery label stock or a plain auto-tiled sheet. Each
// sticker carries a QR encoding the voter URL, the 6-char token in human-
// readable monospace (for the credentialer), and a small event-name label.
//
// QR codes are drawn as vector rectangles straight from the module matrix
// (no PNG raster step), so even a 5,000-sticker batch renders in seconds and
// the PDF stays small and crisp. The PDF is streamed to disk so large batches
// stay memory-bounded.

const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const fs = require('fs');

const IN = 72; // PDF points per inch
const QR_QUIET = 2; // quiet-zone width, in QR modules, on each side

const PAGE_SIZES = {
  letter: { w: 8.5 * IN, h: 11 * IN, label: 'Letter' },
  a4:     { w: 8.2677 * IN, h: 11.6929 * IN, label: 'A4' },
};

// kind 'grid' — fixed Avery layout (US Letter stock).
// kind 'auto' — grid computed to tile the chosen page; cut guides drawn.
const LABEL_PRESETS = {
  '1x1':     { label: '1" × 1"',     kind: 'auto', w: 1.0 * IN, h: 1.0 * IN },
  '1.5x1.5': { label: '1.5" × 1.5"', kind: 'auto', w: 1.5 * IN, h: 1.5 * IN },
  '2x2':     { label: '2" × 2"',     kind: 'auto', w: 2.0 * IN, h: 2.0 * IN },
  avery_8460: {
    label: 'Avery 8460 (1" × 2-5/8")', kind: 'grid',
    w: 2.625 * IN, h: 1.0 * IN, cols: 3, rows: 10,
    marginLeft: 0.1875 * IN, marginTop: 0.5 * IN, pitchX: 2.75 * IN, pitchY: 1.0 * IN,
  },
  avery_5160: {
    label: 'Avery 5160 (1" × 2-5/8")', kind: 'grid',
    w: 2.625 * IN, h: 1.0 * IN, cols: 3, rows: 10,
    marginLeft: 0.1875 * IN, marginTop: 0.5 * IN, pitchX: 2.75 * IN, pitchY: 1.0 * IN,
  },
  avery_5163: {
    label: 'Avery 5163 (2" × 4")', kind: 'grid',
    w: 4.0 * IN, h: 2.0 * IN, cols: 2, rows: 5,
    marginLeft: 0.15625 * IN, marginTop: 0.5 * IN, pitchX: 4.1875 * IN, pitchY: 2.0 * IN,
  },
  custom: { label: 'Custom', kind: 'auto' }, // w/h supplied by caller
};

/**
 * Resolve the sticker dimensions and per-page placement for a chosen preset.
 * @returns {{ sticker:{w,h}, page:{w,h}, perPage:number,
 *             origin:(slot:number)=>{x,y}, kind:string }}
 */
function resolveLayout({ sizePreset, customWidth, customHeight, pageSize }) {
  const preset = LABEL_PRESETS[sizePreset];
  if (!preset) throw new Error(`Unknown sticker size preset: ${sizePreset}`);

  if (preset.kind === 'grid') {
    // Avery stock is US Letter regardless of the page-size selector.
    const page = PAGE_SIZES.letter;
    const { w, h, cols, rows, marginLeft, marginTop, pitchX, pitchY } = preset;
    return {
      sticker: { w, h }, page, kind: 'grid', perPage: cols * rows,
      origin: (slot) => {
        const col = slot % cols;
        const row = Math.floor(slot / cols);
        return { x: marginLeft + col * pitchX, y: marginTop + row * pitchY };
      },
    };
  }

  // auto / custom — tile the chosen page.
  const page = PAGE_SIZES[pageSize] || PAGE_SIZES.letter;
  const w = sizePreset === 'custom' ? customWidth : preset.w;
  const h = sizePreset === 'custom' ? customHeight : preset.h;
  if (!(w > 0) || !(h > 0)) throw new Error('Custom sticker width/height must be positive');

  const margin = 0.4 * IN;
  const gap = 0.08 * IN;
  const cols = Math.floor((page.w - 2 * margin + gap) / (w + gap));
  const rows = Math.floor((page.h - 2 * margin + gap) / (h + gap));
  if (cols < 1 || rows < 1) {
    throw new Error('Sticker is too large to fit the selected page size');
  }
  const gridW = cols * w + (cols - 1) * gap;
  const gridH = rows * h + (rows - 1) * gap;
  const offX = (page.w - gridW) / 2;
  const offY = (page.h - gridH) / 2;
  return {
    sticker: { w, h }, page, kind: 'auto', perPage: cols * rows,
    origin: (slot) => {
      const col = slot % cols;
      const row = Math.floor(slot / cols);
      return { x: offX + col * (w + gap), y: offY + row * (h + gap) };
    },
  };
}

/**
 * Draw a QR code as vector rectangles inside a `size`×`size` box at (x,y).
 * Dark modules are coalesced into horizontal runs to keep the path compact.
 */
function drawQr(doc, text, x, y, size, ecl) {
  const qr = QRCode.create(text, { errorCorrectionLevel: ecl });
  const n = qr.modules.size;
  const cells = qr.modules.data; // length n*n, truthy = dark module
  const m = size / (n + QR_QUIET * 2); // points per module

  doc.save();
  // Explicit white field so the quiet zone is guaranteed white.
  doc.rect(x, y, size, size).fill('#ffffff');
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (cells[r * n + c]) {
        const runStart = c;
        while (c < n && cells[r * n + c]) c++;
        doc.rect(x + (runStart + QR_QUIET) * m, y + (r + QR_QUIET) * m, (c - runStart) * m, m);
      } else {
        c++;
      }
    }
  }
  doc.fill('#000000'); // single fill for all accumulated module rects
  doc.restore();
}

/** Largest font size (≤ maxSize, ≥ minSize) at which `text` fits `maxWidth`. */
function fitFontSize(doc, text, font, maxWidth, maxSize, minSize) {
  doc.font(font);
  for (let size = maxSize; size > minSize; size -= 0.5) {
    doc.fontSize(size);
    if (doc.widthOfString(text) <= maxWidth) return size;
  }
  return minSize;
}

/** Truncate `text` with an ellipsis until it fits `maxWidth` at the current font/size. */
function ellipsize(doc, text, maxWidth) {
  if (doc.widthOfString(text) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && doc.widthOfString(t + '…') > maxWidth) t = t.slice(0, -1);
  return t + '…';
}

/** Draw one sticker (QR + token + event name) inside the box at (x,y,w,h). */
function renderSticker(doc, x, y, w, h, { qrText, token, eventName, ecl, drawGuide }) {
  if (drawGuide) {
    doc.save().lineWidth(0.25).strokeColor('#d0d0d0').rect(x, y, w, h).stroke().restore();
  }

  const pad = Math.max(Math.min(w, h) * 0.06, 3);
  const wide = w >= h * 1.6;

  if (wide) {
    // QR on the left, text stacked on the right.
    const qrSize = h - 2 * pad;
    drawQr(doc, qrText, x + pad, y + pad, qrSize, ecl);

    const textX = x + pad + qrSize + pad;
    const textW = x + w - pad - textX;
    if (textW > 12) {
      const tokenSize = fitFontSize(doc, token, 'Courier-Bold', textW, Math.min(h * 0.34, 22), 6);
      const nameSize = Math.max(tokenSize * 0.5, 4.5);
      const blockH = nameSize + 3 + tokenSize;
      let ty = y + (h - blockH) / 2;

      doc.font('Helvetica').fontSize(nameSize).fillColor('#555');
      doc.text(ellipsize(doc, eventName, textW), textX, ty, { width: textW, lineBreak: false });
      ty += nameSize + 3;

      doc.font('Courier-Bold').fontSize(tokenSize).fillColor('#000');
      doc.text(token, textX, ty, { width: textW, lineBreak: false });
    }
  } else {
    // QR on top, token below; event-name line above the QR when there is room.
    const showName = h >= 1.2 * IN;
    const nameSize = showName ? Math.max(h * 0.085, 4.5) : 0;
    const nameGap = showName ? 2 : 0;
    const tokenBandH = Math.max(h * 0.2, 9);
    const qrAvail = h - 2 * pad - tokenBandH - nameSize - nameGap;
    const qrSize = Math.max(Math.min(w - 2 * pad, qrAvail), 8);

    let cy = y + pad;
    if (showName) {
      doc.font('Helvetica').fontSize(nameSize).fillColor('#555');
      doc.text(ellipsize(doc, eventName, w - 2 * pad), x + pad, cy,
        { width: w - 2 * pad, align: 'center', lineBreak: false });
      cy += nameSize + nameGap;
    }

    drawQr(doc, qrText, x + (w - qrSize) / 2, cy, qrSize, ecl);
    cy += qrSize + 1;

    const tokenSize = fitFontSize(doc, token, 'Courier-Bold', w - 2 * pad, Math.min(tokenBandH, 14), 5);
    doc.font('Courier-Bold').fontSize(tokenSize).fillColor('#000');
    doc.text(token, x + pad, cy + (tokenBandH - tokenSize) / 2, { width: w - 2 * pad, align: 'center', lineBreak: false });
  }
  doc.fillColor('#000');
}

/**
 * Generate the sticker-sheet PDF.
 *
 * @param {object}   opts
 * @param {string}   opts.outputPath       - file to write the PDF to
 * @param {string[]} opts.tokens           - plaintext 6-char tokens
 * @param {string}   opts.sizePreset       - key of LABEL_PRESETS
 * @param {number}  [opts.customWidth]     - inches, required when sizePreset='custom'
 * @param {number}  [opts.customHeight]    - inches, required when sizePreset='custom'
 * @param {string}   opts.pageSize         - 'letter' | 'a4' (ignored for Avery presets)
 * @param {string}   opts.errorCorrection  - 'M' | 'H'
 * @param {string}   opts.eventName
 * @param {string}   opts.eventCode
 * @param {string}   opts.baseUrl          - e.g. 'https://vote.example.org'
 * @returns {Promise<{ pages:number }>}
 */
async function generateStickerPdf({
  outputPath, tokens, sizePreset, customWidth, customHeight,
  pageSize, errorCorrection, eventName, eventCode, baseUrl,
}) {
  const ecl = errorCorrection === 'H' ? 'H' : 'M';
  const layout = resolveLayout({
    sizePreset,
    customWidth: customWidth != null ? customWidth * IN : undefined,
    customHeight: customHeight != null ? customHeight * IN : undefined,
    pageSize,
  });

  const { sticker, page, perPage, origin, kind } = layout;
  const base = String(baseUrl || '').replace(/\/+$/, '');

  const doc = new PDFDocument({ size: [page.w, page.h], margin: 0, autoFirstPage: false });
  const stream = fs.createWriteStream(outputPath);
  doc.pipe(stream);

  let pages = 0;
  for (let i = 0; i < tokens.length; i++) {
    const slot = i % perPage;
    if (slot === 0) { doc.addPage({ size: [page.w, page.h], margin: 0 }); pages++; }

    const token = tokens[i];
    const { x, y } = origin(slot);
    renderSticker(doc, x, y, sticker.w, sticker.h, {
      qrText: `${base}/${eventCode}/?t=${token}`,
      token, eventName, ecl, drawGuide: kind === 'auto',
    });
  }

  doc.end();
  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
  return { pages };
}

module.exports = { generateStickerPdf, LABEL_PRESETS, PAGE_SIZES };
