#!/usr/bin/env node
/**
 * Apply a recovered draft spec to all rounds of a race.
 *
 * Usage:
 *   node server/scripts/applyRecoveredSpec.js \
 *     --draft-spec uploads/elections/12/recovery-source-pdfs/race-74.draft-spec.json \
 *     --race-id 74 \
 *     [--dry-run] [--uploads-dir <path>]
 *
 * Implementation: thin CLI wrapper around server/src/services/ballotSpecRecovery.js
 * — same code path as the admin API.
 */

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { applyDraftSpecToRace } = require('../src/services/ballotSpecRecovery');

function parseArgs(argv) {
  const out = { dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--draft-spec') out.draftSpec = argv[++i];
    else if (a === '--race-id') out.raceId = parseInt(argv[++i], 10);
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--uploads-dir') out.uploadsDir = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node applyRecoveredSpec.js --draft-spec <path> --race-id <id> [--dry-run] [--uploads-dir <path>]');
      process.exit(0);
    }
  }
  if (!out.draftSpec || !out.raceId) {
    console.error('Required: --draft-spec <path> --race-id <id>');
    process.exit(1);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const draftPath = path.resolve(args.draftSpec);
  if (!fs.existsSync(draftPath)) throw new Error(`Draft spec not found: ${draftPath}`);
  const draftSpec = JSON.parse(fs.readFileSync(draftPath, 'utf8'));

  const db = require('../src/db');
  const result = await applyDraftSpecToRace({
    draftSpec,
    raceId: args.raceId,
    db,
    dryRun: args.dryRun,
    uploadsDir: args.uploadsDir,
  });

  if (!result.ok) {
    console.error('FAILED:', result.error);
    if (result.candidate_matches) {
      console.error('\nCandidate matches:');
      for (const m of result.candidate_matches) {
        console.error(`  ${m.db ? 'OK   ' : 'FAIL '} pdf=${JSON.stringify(m.pdf_name)} -> ${m.db ? `db.id=${m.db.id} (${m.db.name}) [${m.method}]` : 'NO MATCH'}`);
      }
    }
    await db.pool.end();
    process.exit(2);
  }

  console.log(`Race: ${result.race.name} (id=${result.race.id}, election=${result.race.election_name})`);
  console.log('\nCandidate matches:');
  for (const m of result.candidate_matches) {
    console.log(`  OK   pdf=${JSON.stringify(m.pdf_name)} -> db.id=${m.db.id} (${m.db.name}) [${m.method}]`);
  }
  if (result.missing_from_pdf.length > 0) {
    console.warn('\nWARN: DB candidates with no oval on the printed paper:');
    for (const c of result.missing_from_pdf) {
      console.warn(`  id=${c.id} status=${c.status} name=${JSON.stringify(c.name)}`);
    }
  }

  if (result.dry_run) {
    console.log('\nDRY RUN — would update these rounds:');
    for (const r of result.rounds_to_update) {
      console.log(`  round ${r.round_id} (round_number=${r.round_number}): ${r.target}${r.backup ? ` [backup: ${path.basename(r.backup)}]` : ''}`);
    }
  } else {
    console.log(`\nUpdated ${result.rounds_updated.length} round(s):`);
    for (const r of result.rounds_updated) {
      console.log(`  round ${r.round_id} (round_number=${r.round_number}): ${r.target}${r.backup ? ` [backup: ${path.basename(r.backup)}]` : ''}`);
    }
    console.log(`\nLogged to ${result.recovery_log}`);
    console.log('Done. Test by physically scanning a marked ballot for this race.');
  }

  await db.pool.end();
}

main().catch(e => {
  console.error('FATAL:', e.message || e);
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(1);
});
