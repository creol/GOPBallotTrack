const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const db = require('../db');

const UPLOADS_BASE = path.join(__dirname, '..', '..', '..', 'uploads');

function slugify(s) {
  return String(s || 'race')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'race';
}

/**
 * Race Summary PDF — single-page official outcome record for one race.
 * Includes total votes, per-candidate vote totals + percentages for each round,
 * and the chair's official designations (Official Nominee / Progress to Primary).
 */
async function generateRaceSummaryPdf(raceId) {
  const { rows: [race] } = await db.query('SELECT * FROM races WHERE id = $1', [raceId]);
  if (!race) throw new Error('Race not found');

  const { rows: [election] } = await db.query('SELECT * FROM elections WHERE id = $1', [race.election_id]);
  if (!election) throw new Error('Election not found');

  const { rows: candidates } = await db.query(
    'SELECT * FROM candidates WHERE race_id = $1 ORDER BY display_order',
    [raceId]
  );

  const { rows: rounds } = await db.query(
    "SELECT * FROM rounds WHERE race_id = $1 AND status != 'canceled' ORDER BY round_number",
    [raceId]
  );

  const roundResults = [];
  for (const round of rounds) {
    const { rows: results } = await db.query(
      `SELECT rr.*, c.name as candidate_name
       FROM round_results rr
       JOIN candidates c ON c.id = rr.candidate_id
       WHERE rr.round_id = $1
       ORDER BY rr.vote_count DESC`,
      [round.id]
    );
    if (results.length > 0) roundResults.push({ round, results });
  }

  const finalizedRounds = roundResults.filter(rr => rr.round.status === 'round_finalized');
  const decidingEntry = finalizedRounds.length > 0
    ? finalizedRounds[finalizedRounds.length - 1]
    : (roundResults.length > 0 ? roundResults[roundResults.length - 1] : null);

  const officialNominees = candidates.filter(c => c.final_designation === 'official_nominee');
  const progressPrimary = candidates.filter(c => c.final_designation === 'progress_to_primary');

  const outDir = path.join(UPLOADS_BASE, 'elections', String(race.election_id), 'races', String(raceId));
  fs.mkdirSync(outDir, { recursive: true });
  const pdfPath = path.join(outDir, 'race-summary.pdf');

  const doc = new PDFDocument({ size: 'LETTER', margin: 40 });
  const stream = fs.createWriteStream(pdfPath);
  doc.pipe(stream);

  const PAGE_LEFT = 40;
  const PAGE_WIDTH = 612 - 80;
  const PAGE_BOTTOM = 720;

  const numRounds = roundResults.length;
  const compact = numRounds >= 3;
  const veryCompact = numRounds >= 5;

  // === Header band ===
  doc.fontSize(20).font('Helvetica-Bold').fillColor('black')
    .text(election.name, PAGE_LEFT, 50, { width: PAGE_WIDTH, align: 'center' });
  doc.moveDown(0.2);
  doc.fontSize(12).font('Helvetica').fillColor('#555')
    .text('Official Race Summary', { width: PAGE_WIDTH, align: 'center' });
  if (election.date) {
    doc.fontSize(10).fillColor('#666').text(
      new Date(election.date).toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      }),
      { width: PAGE_WIDTH, align: 'center' }
    );
  }
  doc.fillColor('black');
  doc.moveDown(0.4);
  doc.moveTo(PAGE_LEFT, doc.y).lineTo(PAGE_LEFT + PAGE_WIDTH, doc.y).lineWidth(1).stroke();
  doc.moveDown(0.5);

  // === Race title ===
  doc.fontSize(17).font('Helvetica-Bold').fillColor('black')
    .text(race.name, PAGE_LEFT, doc.y, { width: PAGE_WIDTH, align: 'center' });
  doc.moveDown(0.15);
  const statusLabel = race.status === 'results_finalized' ? 'Race Finalized' : `Status: ${race.status}`;
  doc.fontSize(10).font('Helvetica').fillColor('#666')
    .text(statusLabel, { width: PAGE_WIDTH, align: 'center' });
  doc.fillColor('black');
  doc.moveDown(0.5);

  // === Official Designations block ===
  if (officialNominees.length > 0 || progressPrimary.length > 0) {
    const boxX = PAGE_LEFT;
    const boxY = doc.y;
    const boxWidth = PAGE_WIDTH;

    const lines = [];
    if (officialNominees.length > 0) {
      lines.push({ label: 'Official Nominee' + (officialNominees.length > 1 ? 's' : '') + ':', names: officialNominees.map(c => c.name).join(', ') });
    }
    if (progressPrimary.length > 0) {
      lines.push({ label: 'Advancing to Primary:', names: progressPrimary.map(c => c.name).join(', ') });
    }

    const boxHeight = 14 + lines.length * 18;

    doc.lineWidth(1.5).strokeColor('#166534')
      .rect(boxX, boxY, boxWidth, boxHeight).stroke();
    doc.strokeColor('black');

    let lineY = boxY + 8;
    for (const line of lines) {
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#166534')
        .text(line.label, boxX + 10, lineY, { continued: true });
      doc.font('Helvetica').fillColor('black').text(' ' + line.names);
      lineY += 18;
    }
    doc.fillColor('black');
    doc.y = boxY + boxHeight + 10;
  }

  // === Round-by-round results ===
  const headerSize = veryCompact ? 10 : (compact ? 11 : 12);
  const rowSize = veryCompact ? 8 : (compact ? 9 : 10);
  const rowGap = veryCompact ? 0.05 : (compact ? 0.1 : 0.2);
  const blockGap = veryCompact ? 0.3 : (compact ? 0.5 : 0.7);

  const col1 = PAGE_LEFT;
  const col2 = PAGE_LEFT + 280;
  const col3 = PAGE_LEFT + 380;

  for (const { round, results } of roundResults) {
    const totalVotes = results.reduce((s, r) => s + r.vote_count, 0);

    doc.fontSize(headerSize).font('Helvetica-Bold').fillColor('black')
      .text(`Round ${round.round_number}${round.paper_color ? '  —  ' + round.paper_color : ''}`, col1, doc.y);
    doc.moveDown(0.2);

    doc.fontSize(rowSize - 1).font('Helvetica-Bold');
    const headerY = doc.y;
    doc.text('Candidate', col1, headerY);
    doc.text('Votes', col2, headerY);
    doc.text('Percentage', col3, headerY);
    doc.moveDown(0.15);
    doc.moveTo(col1, doc.y).lineTo(col1 + PAGE_WIDTH, doc.y).lineWidth(0.5).stroke();
    doc.moveDown(0.2);

    doc.font('Helvetica').fontSize(rowSize);
    for (const r of results) {
      const y = doc.y;
      doc.text(r.candidate_name, col1, y, { width: 270 });
      doc.text(String(r.vote_count), col2, y);
      doc.text(`${Number(r.percentage).toFixed(5)}%`, col3, y);
      doc.moveDown(rowGap + 0.15);
    }
    doc.moveDown(0.1);
    doc.fontSize(rowSize - 1).font('Helvetica-Oblique').fillColor('#444')
      .text(`Total votes cast: ${totalVotes}`, col1);
    doc.fillColor('black').font('Helvetica');
    doc.moveDown(blockGap);
  }

  if (roundResults.length === 0) {
    doc.fontSize(11).font('Helvetica').fillColor('#666')
      .text('No results available for this race.', PAGE_LEFT, doc.y, { width: PAGE_WIDTH, align: 'center' });
    doc.fillColor('black');
  }

  // === Race totals strip (deciding round) ===
  if (decidingEntry) {
    const decidingTotal = decidingEntry.results.reduce((s, r) => s + r.vote_count, 0);
    if (doc.y < PAGE_BOTTOM - 30) {
      doc.moveTo(PAGE_LEFT, doc.y).lineTo(PAGE_LEFT + PAGE_WIDTH, doc.y).lineWidth(0.75).stroke();
      doc.moveDown(0.3);
      const decidingLabel = decidingEntry.round.status === 'round_finalized'
        ? `Final round (Round ${decidingEntry.round.round_number}) — Total votes cast: ${decidingTotal}`
        : `Most recent round (Round ${decidingEntry.round.round_number}) — Total votes cast: ${decidingTotal}`;
      doc.fontSize(10).font('Helvetica-Bold').fillColor('black')
        .text(decidingLabel, PAGE_LEFT, doc.y, { width: PAGE_WIDTH, align: 'center' });
    }
  }

  // === Footer ===
  doc.fontSize(7).font('Helvetica').fillColor('#888')
    .text(`Generated by BallotTrack — ${new Date().toLocaleString()}`,
      PAGE_LEFT, 752, { width: PAGE_WIDTH, align: 'center' });

  doc.end();
  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return { pdfPath, downloadName: `${slugify(race.name)}-official-race-summary.pdf` };
}

module.exports = { generateRaceSummaryPdf };
