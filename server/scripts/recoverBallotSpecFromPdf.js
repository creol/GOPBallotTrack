#!/usr/bin/env node
/**
 * Recovery tool: extract OMR scan zones from a printed ballot PDF.
 *
 * Output: a draft ballot-spec.json with candidate names but candidate_id=null.
 * The companion apply tool (applyRecoveredSpec.js) fills in candidate IDs from
 * the DB and writes the finished spec into every round of the race.
 *
 * Usage:
 *   node server/scripts/recoverBallotSpecFromPdf.js \
 *     --pdf path/to/ballot.pdf \
 *     --out path/to/race-XX.draft-spec.json
 *
 * Optional:
 *   --ballot-size <key>           Force the ballot size key (auto-detected by default)
 *   --candidates "n1|n2|..."      Override candidate name detection (in display_order)
 *   --debug                       Verbose log
 *
 * Implementation: just a thin CLI wrapper around the shared service at
 * server/src/services/ballotSpecRecovery.js — same code path as the admin API.
 */

const fs = require('fs');
const path = require('path');
const { extractDraftSpecFromPdf } = require('../src/services/ballotSpecRecovery');

function parseArgs(argv) {
  const out = { debug: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pdf') out.pdf = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--ballot-size') out.ballotSize = argv[++i];
    else if (a === '--candidates') out.candidatesOverride = argv[++i].split('|').map(s => s.trim()).filter(Boolean);
    else if (a === '--debug') out.debug = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node recoverBallotSpecFromPdf.js --pdf <path> --out <path> [--ballot-size <key>] [--candidates "n1|n2|..."] [--debug]');
      process.exit(0);
    }
  }
  if (!out.pdf || !out.out) {
    console.error('Required: --pdf <path> --out <path>');
    process.exit(1);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  console.error(`Reading PDF: ${args.pdf}`);
  const pdfPath = path.resolve(args.pdf);

  const { draftSpec, info } = await extractDraftSpecFromPdf({
    pdfPath,
    ballotSize: args.ballotSize,
    candidatesOverride: args.candidatesOverride,
    sourceName: path.basename(pdfPath),
  });

  console.error(`Ballot size: ${info.ballot_size}`);
  console.error(`QR (cell-local pts): x=${info.qr_position_pts.x.toFixed(2)} y=${info.qr_position_pts.y.toFixed(2)} w=${info.qr_position_pts.width.toFixed(2)} h=${info.qr_position_pts.height.toFixed(2)}`);
  console.error(`Found ${info.candidate_ovals_pts.length} candidate ovals (rx=${info.candidate_ovals_pts[0].rx.toFixed(2)}, ry=${info.candidate_ovals_pts[0].ry.toFixed(2)}):`);
  for (const [i, ov] of info.candidate_ovals_pts.entries()) {
    console.error(`  [${i + 1}] cy=${ov.cy.toFixed(2)} → name=${JSON.stringify(ov.name)}`);
  }

  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  fs.writeFileSync(path.resolve(args.out), JSON.stringify(draftSpec, null, 2));
  console.error(`\nDraft spec written: ${args.out}`);
  console.error('Next: server/scripts/applyRecoveredSpec.js to write specs into rounds.');
}

main().catch(e => {
  console.error('FATAL:', e.message);
  if (process.argv.includes('--debug')) console.error(e.stack);
  process.exit(1);
});
