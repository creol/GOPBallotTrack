const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const db = require('../db');

const UPLOADS_BASE = path.join(__dirname, '..', '..', '..', 'uploads');

/**
 * Event Results Summary — one-page-per-race overview of final results.
 * Shows each race with its outcome and the last published round's results.
 */
async function generateEventSummaryPdf(electionId) {
  const { rows: [election] } = await db.query('SELECT * FROM elections WHERE id = $1', [electionId]);
  if (!election) throw new Error('Election not found');

  const { rows: races } = await db.query(
    'SELECT * FROM races WHERE election_id = $1 ORDER BY display_order',
    [electionId]
  );

  const outDir = path.join(UPLOADS_BASE, 'elections', String(electionId), 'exports');
  fs.mkdirSync(outDir, { recursive: true });
  const pdfPath = path.join(outDir, 'event-results-summary.pdf');

  const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
  const stream = fs.createWriteStream(pdfPath);
  doc.pipe(stream);

  const pageWidth = 612 - 100;

  // Title page
  doc.moveDown(4);
  doc.fontSize(24).font('Helvetica-Bold').text(election.name, { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(16).font('Helvetica').text('Event Results Summary', { align: 'center' });
  doc.moveDown(0.5);
  if (election.date) {
    doc.fontSize(12).text(new Date(election.date).toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    }), { align: 'center' });
  }
  doc.moveDown(1);
  doc.fontSize(10).fillColor('#666').text(`${races.length} race(s)`, { align: 'center' });
  doc.fillColor('black');

  // Each race gets its own section
  for (const race of races) {
    doc.addPage();

    // Race header
    doc.fontSize(18).font('Helvetica-Bold').text(race.name, { align: 'center' });
    doc.moveDown(0.3);

    // Race outcome
    if (race.outcome) {
      let outcomeText = '';
      if (race.outcome_candidate_id) {
        const { rows: [winner] } = await db.query('SELECT name FROM candidates WHERE id = $1', [race.outcome_candidate_id]);
        if (race.outcome === 'winner') outcomeText = `Winner: ${winner?.name || 'Unknown'}`;
        else if (race.outcome === 'advances_primary') outcomeText = `Advances to Primary: ${winner?.name || 'Unknown'}`;
        else outcomeText = `Outcome: ${race.outcome}`;
      } else {
        outcomeText = `Outcome: ${race.outcome}`;
      }
      doc.fontSize(14).font('Helvetica-Bold').fillColor('#166534').text(outcomeText, { align: 'center' });
      doc.fillColor('black');
    } else {
      doc.fontSize(12).font('Helvetica').fillColor('#666').text(`Status: ${race.status}`, { align: 'center' });
      doc.fillColor('black');
    }
    doc.moveDown(1);

    // Get all published/finalized rounds for this race
    const { rows: rounds } = await db.query(
      "SELECT * FROM rounds WHERE race_id = $1 AND status != 'canceled' ORDER BY round_number",
      [race.id]
    );

    for (const round of rounds) {
      const { rows: results } = await db.query(
        `SELECT rr.*, c.name as candidate_name
         FROM round_results rr
         JOIN candidates c ON c.id = rr.candidate_id
         WHERE rr.round_id = $1
         ORDER BY rr.vote_count DESC`,
        [round.id]
      );

      if (results.length === 0) continue;

      const totalVotes = results.reduce((s, r) => s + r.vote_count, 0);

      // Round header
      doc.fontSize(13).font('Helvetica-Bold').text(`Round ${round.round_number} — ${round.paper_color || ''}`);
      if (round.published_at) {
        doc.fontSize(8).font('Helvetica').fillColor('#666')
          .text(`Published: ${new Date(round.published_at).toLocaleString()}`);
        doc.fillColor('black');
      }
      doc.moveDown(0.3);

      // Results table
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
      for (const r of results) {
        const y = doc.y;
        const outcomeLabel = r.outcome ? ` (${r.outcome})` : '';
        doc.text(r.candidate_name + outcomeLabel, col1, y);
        doc.text(String(r.vote_count), col2, y);
        doc.text(`${Number(r.percentage).toFixed(5)}%`, col3, y);
        doc.moveDown(0.2);
      }
      doc.moveDown(0.2);
      doc.fontSize(9).font('Helvetica').text(`Total votes: ${totalVotes}`, col1);
      doc.moveDown(1);

      if (doc.y > 650) doc.addPage();
    }

    if (rounds.length === 0 || rounds.every(r => r.status === 'canceled')) {
      doc.fontSize(10).font('Helvetica').fillColor('#666').text('No results available for this race.', { align: 'center' });
      doc.fillColor('black');
    }
  }

  // Footer
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

/**
 * Event Results Detail — combines all per-round results PDFs into one document.
 * Each round starts on a new page with full detail (same content as individual round PDFs).
 */
async function generateEventDetailPdf(electionId) {
  const { rows: [election] } = await db.query('SELECT * FROM elections WHERE id = $1', [electionId]);
  if (!election) throw new Error('Election not found');

  const { rows: races } = await db.query(
    'SELECT * FROM races WHERE election_id = $1 ORDER BY display_order',
    [electionId]
  );

  // Generate individual round PDFs and merge via archiving the paths
  const { generateResultsPdf } = require('./resultsPdf');
  const roundPdfs = [];

  for (const race of races) {
    const { rows: rounds } = await db.query(
      "SELECT * FROM rounds WHERE race_id = $1 AND status = 'round_finalized' ORDER BY round_number",
      [race.id]
    );
    for (const round of rounds) {
      try {
        const pdfPath = await generateResultsPdf(round.id);
        roundPdfs.push({ race, round, pdfPath });
      } catch {}
    }
  }

  // Build a combined PDF by reading each round's PDF pages
  // PDFKit can't merge PDFs natively, so we regenerate the content inline
  const outDir = path.join(UPLOADS_BASE, 'elections', String(electionId), 'exports');
  fs.mkdirSync(outDir, { recursive: true });
  const pdfPath = path.join(outDir, 'event-results-detail.pdf');

  const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
  const stream = fs.createWriteStream(pdfPath);
  doc.pipe(stream);

  const pageWidth = 612 - 100;
  const { getComparison } = require('../services/confirmationService');

  // Title page
  doc.moveDown(4);
  doc.fontSize(24).font('Helvetica-Bold').text(election.name, { align: 'center' });
  doc.moveDown(0.5);
  doc.fontSize(16).font('Helvetica').text('Event Results — Full Detail', { align: 'center' });
  doc.moveDown(0.5);
  if (election.date) {
    doc.fontSize(12).text(new Date(election.date).toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    }), { align: 'center' });
  }
  doc.moveDown(1);
  doc.fontSize(10).fillColor('#666').text(`${roundPdfs.length} finalized round(s) across ${races.length} race(s)`, { align: 'center' });
  doc.fillColor('black');

  // For each finalized round, regenerate the full detail content inline
  for (const { race, round } of roundPdfs) {
    doc.addPage();

    const roundId = round.id;

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

    const { rows: usedSerials } = await db.query(
      `SELECT bs.serial_number, c.name as candidate_name
       FROM ballot_serials bs
       LEFT JOIN LATERAL (
         SELECT s.candidate_id FROM scans s
         JOIN passes p ON p.id = s.pass_id
         WHERE s.ballot_serial_id = bs.id AND p.round_id = $1 AND p.status = 'complete'
         ORDER BY p.pass_number DESC LIMIT 1
       ) latest_scan ON true
       LEFT JOIN candidates c ON c.id = latest_scan.candidate_id
       WHERE bs.round_id = $1 AND bs.status = 'counted'
       ORDER BY bs.serial_number`,
      [roundId]
    );

    // === HEADER ===
    doc.fontSize(18).font('Helvetica-Bold').text(election.name, { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(14).text(`${race.name} — Round ${round.round_number}`, { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica').text(`Paper Color: ${round.paper_color}`, { align: 'center' });
    if (round.confirmed_at) {
      doc.text(`Confirmed: ${new Date(round.confirmed_at).toLocaleString()}`, { align: 'center' });
    }
    if (round.published_at) {
      doc.text(`Published: ${new Date(round.published_at).toLocaleString()}`, { align: 'center' });
    }
    doc.moveDown(1);

    // === RESULTS ===
    doc.fontSize(13).font('Helvetica-Bold').text('Results');
    doc.moveDown(0.3);

    const col1 = 50, col2 = 300, col3 = 400;
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('Candidate', col1, doc.y, { continued: false });
    let headerY = doc.y - 11;
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

    // === REMADE BALLOTS ===
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
      headerY = doc.y - 9;
      doc.text('Replacement SN', rCol2, headerY);
      doc.text('Notes', rCol3, headerY);
      doc.text('Reviewed By', rCol4, headerY);
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

    // === SPOILED BALLOTS ===
    doc.fontSize(13).font('Helvetica-Bold').text('Spoiled Ballots');
    doc.moveDown(0.3);
    if (spoiled.length === 0) {
      doc.fontSize(9).font('Helvetica').text('None');
    } else {
      doc.fontSize(8).font('Helvetica-Bold');
      const sCol1 = 50, sCol2 = 140, sCol3 = 250, sCol4 = 400;
      doc.text('SN', sCol1, doc.y, { continued: false });
      headerY = doc.y - 9;
      doc.text('Reason', sCol2, headerY);
      doc.text('Notes', sCol3, headerY);
      doc.text('Reviewed By', sCol4, headerY);
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

    // === PASS COMPARISON ===
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
          if (mismatch) doc.font('Helvetica-Bold').fillColor('red');
          doc.text(val, pCol1 + 150 + i * pColWidth, y);
          doc.font('Helvetica').fillColor('black');
        });
        doc.moveDown(0.2);
      }
    }
    doc.moveDown(1);

    // === OVERRIDE NOTES ===
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

    // === COUNTED BALLOTS ===
    doc.addPage();
    doc.fontSize(13).font('Helvetica-Bold').text(`Counted Ballots — ${race.name} Round ${round.round_number}`);
    doc.moveDown(0.3);
    doc.fontSize(9).font('Helvetica')
      .text(`${usedSerials.length} of ${totalSerials} serial numbers counted`);
    doc.moveDown(0.5);

    if (usedSerials.length > 0) {
      doc.fontSize(8).font('Helvetica-Bold');
      const uCol1 = 50, uCol2 = 160;
      doc.text('Serial Number', uCol1, doc.y, { continued: false });
      headerY = doc.y - 9;
      doc.text('Candidate', uCol2, headerY);
      doc.moveDown(0.2);
      doc.moveTo(uCol1, doc.y).lineTo(uCol1 + pageWidth, doc.y).lineWidth(0.5).stroke();
      doc.moveDown(0.3);
      doc.font('Courier').fontSize(8);
      for (const s of usedSerials) {
        const y = doc.y;
        doc.text(s.serial_number, uCol1, y);
        doc.font('Helvetica').text(s.candidate_name || 'Unknown', uCol2, y);
        doc.font('Courier');
        doc.moveDown(0.2);
        if (doc.y > 700) doc.addPage();
      }
    }

    // === UNUSED SERIAL NUMBERS ===
    doc.addPage();
    doc.fontSize(13).font('Helvetica-Bold').text(`Unused Serial Numbers — ${race.name} Round ${round.round_number}`);
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
        if (doc.y > 700) doc.addPage();
      }
    }
  }

  if (roundPdfs.length === 0) {
    doc.addPage();
    doc.fontSize(12).font('Helvetica').text('No finalized rounds available for detailed results.', { align: 'center' });
  }

  // Footer
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

module.exports = { generateEventSummaryPdf, generateEventDetailPdf };
