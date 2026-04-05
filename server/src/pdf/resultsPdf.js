const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { getComparison } = require('../services/confirmationService');

/**
 * Generate a results PDF for a confirmed/released round.
 * Returns the file path.
 */
async function generateResultsPdf(roundId) {
  // Fetch all data
  const { rows: [round] } = await db.query('SELECT * FROM rounds WHERE id = $1', [roundId]);
  if (!round) throw new Error('Round not found');

  const { rows: [race] } = await db.query('SELECT * FROM races WHERE id = $1', [round.race_id]);
  const { rows: [election] } = await db.query('SELECT * FROM elections WHERE id = $1', [race.election_id]);

  const { rows: results } = await db.query(
    `SELECT rr.*, c.name as candidate_name
     FROM round_results rr
     JOIN candidates c ON c.id = rr.candidate_id
     WHERE rr.round_id = $1
     ORDER BY rr.vote_count DESC`,
    [roundId]
  );

  const { rows: remadeBallots } = await db.query(
    `SELECT rb.*, bs.serial_number as original_sn, rbs.serial_number as replacement_sn
     FROM reviewed_ballots rb
     JOIN ballot_serials bs ON bs.id = rb.original_serial_id
     LEFT JOIN ballot_serials rbs ON rbs.id = rb.replacement_serial_id
     WHERE rb.round_id = $1 AND rb.outcome = 'remade'
     ORDER BY rb.created_at`,
    [roundId]
  );

  const { rows: spoiled } = await db.query(
    `SELECT rb.*, bs.serial_number
     FROM reviewed_ballots rb
     JOIN ballot_serials bs ON bs.id = rb.original_serial_id
     WHERE rb.round_id = $1 AND rb.outcome IN ('spoiled', 'rejected')
     ORDER BY rb.created_at`,
    [roundId]
  );

  const { rows: confirmations } = await db.query(
    'SELECT * FROM round_confirmations WHERE round_id = $1 ORDER BY created_at',
    [roundId]
  );

  const comparison = await getComparison(roundId);

  const { rows: unusedSerials } = await db.query(
    "SELECT serial_number FROM ballot_serials WHERE round_id = $1 AND status = 'unused' ORDER BY serial_number",
    [roundId]
  );

  const { rows: [{ count: totalSerials }] } = await db.query(
    'SELECT COUNT(*) as count FROM ballot_serials WHERE round_id = $1',
    [roundId]
  );

  // Output path
  const outDir = path.join(__dirname, '..', '..', '..', 'uploads', 'elections', String(election.id), 'rounds', String(roundId));
  fs.mkdirSync(outDir, { recursive: true });
  const pdfPath = path.join(outDir, 'results.pdf');

  // Create PDF
  const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
  const stream = fs.createWriteStream(pdfPath);
  doc.pipe(stream);

  const pageWidth = 612 - 100; // letter width minus margins

  // === 1. HEADER ===
  doc.fontSize(18).font('Helvetica-Bold').text(election.name, { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(14).text(`${race.name} — Round ${round.round_number}`, { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(10).font('Helvetica').text(`Paper Color: ${round.paper_color}`, { align: 'center' });
  if (round.confirmed_at) {
    doc.text(`Confirmed: ${new Date(round.confirmed_at).toLocaleString()}`, { align: 'center' });
  }
  if (round.released_at) {
    doc.text(`Released: ${new Date(round.released_at).toLocaleString()}`, { align: 'center' });
  }
  doc.moveDown(1);

  // === 2. RESULTS TABLE ===
  doc.fontSize(13).font('Helvetica-Bold').text('Results');
  doc.moveDown(0.3);

  // Table header
  const col1 = 50, col2 = 300, col3 = 400;
  doc.fontSize(9).font('Helvetica-Bold');
  doc.text('Candidate', col1, doc.y, { continued: false });
  const headerY = doc.y - 11;
  doc.text('Votes', col2, headerY);
  doc.text('Percentage', col3, headerY);
  doc.moveDown(0.2);
  doc.moveTo(col1, doc.y).lineTo(col1 + pageWidth, doc.y).lineWidth(0.5).stroke();
  doc.moveDown(0.3);

  doc.font('Helvetica').fontSize(10);
  const totalVotes = results.reduce((s, r) => s + r.vote_count, 0);
  for (const r of results) {
    const y = doc.y;
    doc.text(r.candidate_name, col1, y);
    doc.text(String(r.vote_count), col2, y);
    doc.text(`${Number(r.percentage).toFixed(5)}%`, col3, y);
    doc.moveDown(0.2);
  }
  doc.moveDown(0.2);
  doc.fontSize(9).font('Helvetica').text(`Total votes: ${totalVotes}`, col1);
  doc.moveDown(1);

  // === 3a. REMADE BALLOTS ===
  doc.fontSize(13).font('Helvetica-Bold').text('Remade Ballots');
  doc.moveDown(0.3);

  if (remadeBallots.length === 0) {
    doc.fontSize(9).font('Helvetica').text('None');
  } else {
    doc.fontSize(9).font('Helvetica').text(`Includes ${remadeBallots.length} remade ballot(s) in candidate totals above.`);
    doc.moveDown(0.2);
    doc.fontSize(8).font('Helvetica-Bold');
    const rCol1 = 50, rCol2 = 140, rCol3 = 250, rCol4 = 400;
    doc.text('Original SN', rCol1, doc.y, { continued: false });
    const rhY = doc.y - 9;
    doc.text('Replacement SN', rCol2, rhY);
    doc.text('Notes', rCol3, rhY);
    doc.text('Reviewed By', rCol4, rhY);
    doc.moveDown(0.2);
    doc.moveTo(rCol1, doc.y).lineTo(rCol1 + pageWidth, doc.y).lineWidth(0.5).stroke();
    doc.moveDown(0.3);

    doc.font('Helvetica').fontSize(8);
    for (const r of remadeBallots) {
      const y = doc.y;
      doc.text(r.original_sn, rCol1, y);
      doc.text(r.replacement_sn || '-', rCol2, y);
      doc.text(r.notes || '-', rCol3, y, { width: 140 });
      doc.text(r.reviewed_by || '-', rCol4, y);
      doc.moveDown(0.3);
    }
  }
  doc.moveDown(1);

  // === 3b. SPOILED BALLOTS ===
  doc.fontSize(13).font('Helvetica-Bold').text('Spoiled Ballots');
  doc.moveDown(0.3);

  if (spoiled.length === 0) {
    doc.fontSize(9).font('Helvetica').text('None');
  } else {
    doc.fontSize(8).font('Helvetica-Bold');
    const sCol1 = 50, sCol2 = 140, sCol3 = 250, sCol4 = 400;
    doc.text('SN', sCol1, doc.y, { continued: false });
    const shY = doc.y - 9;
    doc.text('Reason', sCol2, shY);
    doc.text('Notes', sCol3, shY);
    doc.text('Reviewed By', sCol4, shY);
    doc.moveDown(0.2);
    doc.moveTo(sCol1, doc.y).lineTo(sCol1 + pageWidth, doc.y).lineWidth(0.5).stroke();
    doc.moveDown(0.3);

    doc.font('Helvetica').fontSize(8);
    for (const s of spoiled) {
      const y = doc.y;
      doc.text(s.serial_number, sCol1, y);
      doc.text(s.outcome || s.flag_reason || '-', sCol2, y);
      doc.text(s.notes || '-', sCol3, y, { width: 140 });
      doc.text(s.reviewed_by || '-', sCol4, y);
      doc.moveDown(0.3);
    }
  }
  doc.moveDown(1);

  // === 4. PASS COMPARISON ===
  doc.fontSize(13).font('Helvetica-Bold').text('Pass Comparison');
  doc.moveDown(0.3);

  if (comparison.passes.length > 0) {
    const passNums = comparison.passes.map(p => p.pass_number);
    const pCol1 = 50;
    const pColWidth = Math.min(80, (pageWidth - 150) / passNums.length);

    doc.fontSize(8).font('Helvetica-Bold');
    doc.text('Candidate', pCol1, doc.y, { continued: false });
    const pcY = doc.y - 9;
    passNums.forEach((n, i) => {
      doc.text(`Pass ${n}`, pCol1 + 150 + i * pColWidth, pcY);
    });
    doc.moveDown(0.2);
    doc.moveTo(pCol1, doc.y).lineTo(pCol1 + pageWidth, doc.y).lineWidth(0.5).stroke();
    doc.moveDown(0.3);

    doc.font('Helvetica').fontSize(8);
    for (const row of comparison.comparison) {
      const y = doc.y;
      doc.text(row.candidate_name, pCol1, y);
      const counts = Object.values(row.counts);
      const mismatch = new Set(counts).size > 1;
      passNums.forEach((n, i) => {
        const val = String(row.counts[n] ?? '-');
        if (mismatch) {
          doc.font('Helvetica-Bold').fillColor('red');
        }
        doc.text(val, pCol1 + 150 + i * pColWidth, y);
        doc.font('Helvetica').fillColor('black');
      });
      doc.moveDown(0.2);
    }
  }
  doc.moveDown(1);

  // === 5. OVERRIDE NOTES ===
  const overrides = confirmations.filter(c => c.is_override);
  if (overrides.length > 0) {
    doc.fontSize(13).font('Helvetica-Bold').text('Override Notes');
    doc.moveDown(0.3);
    doc.fontSize(9).font('Helvetica');
    for (const o of overrides) {
      doc.text(`${o.confirmed_by_name} (${o.confirmed_by_role}): ${o.override_notes}`);
      doc.moveDown(0.2);
    }
    doc.moveDown(1);
  }

  // === 6. UNUSED SERIAL NUMBERS ===
  doc.addPage();
  doc.fontSize(13).font('Helvetica-Bold').text('Unused Serial Numbers');
  doc.moveDown(0.3);
  doc.fontSize(9).font('Helvetica')
    .text(`${unusedSerials.length} of ${totalSerials} serial numbers unused`);
  doc.moveDown(0.5);

  if (unusedSerials.length > 0) {
    doc.fontSize(8).font('Courier');
    const cols = 4;
    const colWidth = pageWidth / cols;
    for (let i = 0; i < unusedSerials.length; i += cols) {
      const y = doc.y;
      for (let j = 0; j < cols && i + j < unusedSerials.length; j++) {
        doc.text(unusedSerials[i + j].serial_number, 50 + j * colWidth, y);
      }
      doc.moveDown(0.2);
      if (doc.y > 700) {
        doc.addPage();
      }
    }
  }

  // === 7. FOOTER ===
  doc.moveDown(2);
  doc.fontSize(8).font('Helvetica').fillColor('#666');
  doc.text(`Generated by BallotTrack — ${new Date().toLocaleString()}`, 50, doc.y, { align: 'center', width: pageWidth });

  doc.end();
  await new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  return pdfPath;
}

module.exports = { generateResultsPdf };
