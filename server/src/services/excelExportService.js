const ExcelJS = require('exceljs');
const db = require('../db');

const SKIP_ROUND_STATUSES = new Set(['pending_needs_action', 'ready']);

function sanitizeSheetName(raw) {
  // Excel sheet names: max 31 chars, no [ ] : * ? / \
  const cleaned = String(raw || '').replace(/[\[\]:*?\/\\]/g, '-');
  return cleaned.length > 31 ? cleaned.slice(0, 31) : cleaned;
}

function statusFallbackVote(serialStatus) {
  if (!serialStatus) return '';
  switch (serialStatus) {
    case 'unused': return '(unused)';
    case 'spoiled': return '(spoiled)';
    case 'damaged': return '(damaged)';
    case 'remade': return '(remade)';
    case 'counted': return '';
    default: return `(${serialStatus})`;
  }
}

function buildCorrectionsCell(row) {
  const parts = [];
  if (row.omr_method && row.omr_method !== 'auto') {
    parts.push(`method: ${row.omr_method}`);
  }
  if (row.review_outcome) {
    let s = `review: ${row.review_outcome}`;
    if (row.review_outcome === 'remade' && row.replacement_sn) {
      s += ` → ${row.replacement_sn}`;
    }
    parts.push(s);
  }
  if (row.flag_reason) parts.push(`flag: ${row.flag_reason}`);
  if (row.review_notes) {
    const trimmed = String(row.review_notes).trim();
    if (trimmed) parts.push(`notes: ${trimmed}`);
  }
  return parts.join(' | ');
}

async function generateExcel(electionId) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BallotTrack';
  wb.created = new Date();

  const { rows: [election] } = await db.query(
    'SELECT * FROM elections WHERE id = $1', [electionId]
  );
  if (!election) throw new Error('Election not found');

  const { rows: races } = await db.query(
    'SELECT * FROM races WHERE election_id = $1 ORDER BY display_order, id', [electionId]
  );

  // ----- Tab 1: Summary -----
  const summary = wb.addWorksheet('Summary');
  summary.columns = [
    { header: 'Race', key: 'race', width: 24 },
    { header: 'Round #', key: 'round', width: 8 },
    { header: 'Paper Color', key: 'color', width: 14 },
    { header: 'Status', key: 'status', width: 20 },
    { header: 'Candidate', key: 'candidate', width: 24 },
    { header: 'Votes', key: 'votes', width: 10 },
    { header: 'Percentage', key: 'pct', width: 14 },
  ];
  summary.getRow(1).font = { bold: true };
  summary.views = [{ state: 'frozen', ySplit: 1 }];

  // Title row at top — insert before header
  summary.spliceRows(1, 0, [`${election.name} — Results Summary`]);
  summary.mergeCells(1, 1, 1, 7);
  summary.getRow(1).font = { bold: true, size: 14 };
  summary.getRow(2).font = { bold: true };
  summary.views = [{ state: 'frozen', ySplit: 2 }];

  // Per-round data rows on Summary, plus build round list to drive per-round tabs
  const allRounds = []; // { race, round, results }

  for (const race of races) {
    const { rows: rounds } = await db.query(
      'SELECT * FROM rounds WHERE race_id = $1 ORDER BY round_number', [race.id]
    );

    for (const round of rounds) {
      const { rows: results } = await db.query(
        `SELECT rr.vote_count, rr.percentage, c.name AS candidate_name, c.display_order
         FROM round_results rr
         JOIN candidates c ON c.id = rr.candidate_id
         WHERE rr.round_id = $1
         ORDER BY rr.vote_count DESC, c.display_order`,
        [round.id]
      );

      allRounds.push({ race, round, results });

      if (results.length === 0) {
        const r = summary.addRow({
          race: race.name,
          round: round.round_number,
          color: round.paper_color || '',
          status: round.status || '',
          candidate: '(no results yet)',
          votes: null,
          pct: null,
        });
        r.getCell('votes').value = null;
        r.getCell('pct').value = null;
      } else {
        for (const res of results) {
          const r = summary.addRow({
            race: race.name,
            round: round.round_number,
            color: round.paper_color || '',
            status: round.status || '',
            candidate: res.candidate_name,
            votes: Number(res.vote_count),
            pct: res.percentage == null ? null : Number(res.percentage),
          });
          r.getCell('pct').numFmt = '0.000';
        }
      }
      // Blank separator row
      summary.addRow([]);
    }
  }

  // ----- Per-round tabs -----
  const usedSheetNames = new Set(['Summary']);

  for (const { race, round, results } of allRounds) {
    if (SKIP_ROUND_STATUSES.has(round.status)) continue;

    let baseName = sanitizeSheetName(`${race.name} R${round.round_number}`);
    let name = baseName;
    let suffix = 2;
    while (usedSheetNames.has(name)) {
      const tag = ` (${suffix})`;
      name = sanitizeSheetName(baseName.slice(0, 31 - tag.length) + tag);
      suffix++;
    }
    usedSheetNames.add(name);

    const ws = wb.addWorksheet(name);

    // Title row
    ws.mergeCells(1, 1, 1, 5);
    ws.getCell(1, 1).value =
      `${election.name} — ${race.name} — Round ${round.round_number}` +
      (round.paper_color ? ` (${round.paper_color})` : '') +
      ` — ${round.status}`;
    ws.getCell(1, 1).font = { bold: true, size: 13 };

    // Per-candidate inline result summary
    let curRow = 2;
    ws.getCell(curRow, 1).value = 'Candidate';
    ws.getCell(curRow, 2).value = 'Votes';
    ws.getCell(curRow, 3).value = 'Percentage';
    ws.getRow(curRow).font = { bold: true };
    curRow++;
    if (results.length === 0) {
      ws.getCell(curRow, 1).value = '(no results yet)';
      curRow++;
    } else {
      for (const res of results) {
        ws.getCell(curRow, 1).value = res.candidate_name;
        ws.getCell(curRow, 2).value = Number(res.vote_count);
        const pctCell = ws.getCell(curRow, 3);
        pctCell.value = res.percentage == null ? null : Number(res.percentage);
        pctCell.numFmt = '0.000';
        curRow++;
      }
    }

    // Blank row
    curRow++;

    // Ballot detail table headers
    const headerRow = curRow;
    const headers = ['#', 'Serial Number', 'Vote', 'Confidence', 'Corrections'];
    for (let i = 0; i < headers.length; i++) {
      ws.getCell(headerRow, i + 1).value = headers[i];
    }
    ws.getRow(headerRow).font = { bold: true };
    curRow++;

    // Query ballot rows
    const { rows: ballotRows } = await db.query(
      `SELECT
         bs.id            AS serial_id,
         bs.serial_number,
         bs.status        AS serial_status,
         s.candidate_id,
         c.name           AS candidate_name,
         s.omr_confidence,
         s.omr_method,
         rb.outcome       AS review_outcome,
         rb.flag_reason,
         rb.notes         AS review_notes,
         rep.serial_number AS replacement_sn
       FROM ballot_serials bs
       LEFT JOIN LATERAL (
         SELECT sx.* FROM scans sx
         JOIN passes px ON px.id = sx.pass_id
         WHERE sx.ballot_serial_id = bs.id AND px.round_id = $1
         ORDER BY sx.scanned_at DESC LIMIT 1
       ) s ON TRUE
       LEFT JOIN candidates c ON c.id = s.candidate_id
       LEFT JOIN reviewed_ballots rb ON rb.original_serial_id = bs.id AND rb.round_id = $1
       LEFT JOIN ballot_serials rep ON rep.id = rb.replacement_serial_id
       WHERE bs.round_id = $1
       ORDER BY bs.serial_number`,
      [round.id]
    );

    let n = 1;
    for (const row of ballotRows) {
      // # column
      ws.getCell(curRow, 1).value = n;

      // SN hyperlink
      const snCell = ws.getCell(curRow, 2);
      const url = `/api/public/${electionId}/ballots/${encodeURIComponent(row.serial_number)}`;
      snCell.value = { text: row.serial_number, hyperlink: url };
      snCell.font = { color: { argb: 'FF1D4ED8' }, underline: true };

      // Vote
      const voteCell = ws.getCell(curRow, 3);
      if (row.candidate_name) {
        voteCell.value = row.candidate_name;
      } else {
        voteCell.value = statusFallbackVote(row.serial_status);
      }

      // Confidence
      const confCell = ws.getCell(curRow, 4);
      if (row.omr_method === 'manual' || row.omr_method === 'manual_correction') {
        confCell.value = 'manual';
      } else if (row.omr_confidence != null) {
        confCell.value = Number(row.omr_confidence);
        confCell.numFmt = '0.000';
      } else {
        confCell.value = null;
      }

      // Corrections
      ws.getCell(curRow, 5).value = buildCorrectionsCell(row);

      curRow++;
      n++;
    }

    // Column widths
    ws.getColumn(1).width = 5;
    ws.getColumn(2).width = 18;
    ws.getColumn(3).width = 24;
    ws.getColumn(4).width = 12;
    ws.getColumn(5).width = 50;

    // Freeze header row, autoFilter on the table range (only if there's data)
    ws.views = [{ state: 'frozen', ySplit: headerRow }];
    if (n > 1) {
      ws.autoFilter = {
        from: { row: headerRow, column: 1 },
        to:   { row: curRow - 1, column: 5 },
      };
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

module.exports = { generateExcel };
