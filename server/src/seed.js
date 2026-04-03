const crypto = require('crypto');
const db = require('./db');

const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function makeSN() {
  const bytes = crypto.randomBytes(8);
  let sn = '';
  for (let i = 0; i < 8; i++) sn += CHARSET[bytes[i] % CHARSET.length];
  return sn;
}

async function seed() {
  // Check if sample election already exists
  const { rows } = await db.query(
    "SELECT id FROM elections WHERE is_sample = true LIMIT 1"
  );

  if (rows.length > 0) {
    console.log('Sample election already exists, skipping seed.');
    return;
  }

  console.log('Seeding sample election...');

  // Create sample election
  const { rows: [election] } = await db.query(
    `INSERT INTO elections (name, date, description, status, is_sample)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    ['2026 State Convention', '2026-06-15', 'Sample election for demonstration purposes', 'active', true]
  );

  // Create ballot boxes
  const { rows: [box1] } = await db.query(
    'INSERT INTO ballot_boxes (election_id, name) VALUES ($1, $2) RETURNING id',
    [election.id, 'Box A']
  );
  await db.query(
    'INSERT INTO ballot_boxes (election_id, name) VALUES ($1, $2)',
    [election.id, 'Box B']
  );

  // Create races
  const { rows: [chairRace] } = await db.query(
    `INSERT INTO races (election_id, name, threshold_type, display_order, status)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [election.id, 'Chair', 'majority', 1, 'pending']
  );

  const { rows: [viceChairRace] } = await db.query(
    `INSERT INTO races (election_id, name, threshold_type, display_order, status)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [election.id, 'Vice Chair', 'majority', 2, 'pending']
  );

  // Create candidates for Chair race
  const chairCandNames = ['Alice Johnson', 'Bob Smith', 'Carol Williams'];
  const chairCands = [];
  for (let i = 0; i < chairCandNames.length; i++) {
    const { rows: [c] } = await db.query(
      `INSERT INTO candidates (race_id, name, display_order) VALUES ($1, $2, $3) RETURNING id`,
      [chairRace.id, chairCandNames[i], i + 1]
    );
    chairCands.push(c.id);
  }

  // Create candidates for Vice Chair race
  const vcCandNames = ['David Brown', 'Eve Davis', 'Frank Miller'];
  const vcCands = [];
  for (let i = 0; i < vcCandNames.length; i++) {
    const { rows: [c] } = await db.query(
      `INSERT INTO candidates (race_id, name, display_order) VALUES ($1, $2, $3) RETURNING id`,
      [viceChairRace.id, vcCandNames[i], i + 1]
    );
    vcCands.push(c.id);
  }

  // --- Pre-populate scan data for Chair race, Round 1 (released) ---
  const { rows: [round1] } = await db.query(
    `INSERT INTO rounds (race_id, round_number, paper_color, status, confirmed_by, confirmed_at, released_by, released_at)
     VALUES ($1, 1, 'White', 'released', 'Judge Smith', NOW(), 'Chair Jones', NOW()) RETURNING id`,
    [chairRace.id]
  );

  // Generate serial numbers
  const serials = [];
  const votes = [0, 0, 0, 0, 0, 1, 1, 2]; // 5x Alice, 2x Bob, 1x Carol = 62.5%, 25%, 12.5%
  // Actually let's be cleaner: 10 ballots — 6 Alice, 3 Bob, 1 Carol
  const voteDistribution = [0,0,0,0,0,0, 1,1,1, 2]; // indices into chairCands
  for (let i = 0; i < voteDistribution.length; i++) {
    const sn = makeSN();
    const { rows: [bs] } = await db.query(
      `INSERT INTO ballot_serials (round_id, serial_number, status) VALUES ($1, $2, 'counted') RETURNING id`,
      [round1.id, sn]
    );
    serials.push({ id: bs.id, sn, candidateIdx: voteDistribution[i] });
  }
  // Add a few unused serials
  for (let i = 0; i < 5; i++) {
    await db.query(
      `INSERT INTO ballot_serials (round_id, serial_number, status) VALUES ($1, $2, 'unused')`,
      [round1.id, makeSN()]
    );
  }

  // Pass 1
  const { rows: [pass1] } = await db.query(
    `INSERT INTO passes (round_id, pass_number, status, completed_at) VALUES ($1, 1, 'complete', NOW()) RETURNING id`,
    [round1.id]
  );
  for (const s of serials) {
    await db.query(
      `INSERT INTO scans (pass_id, ballot_serial_id, candidate_id, ballot_box_id, scanned_by)
       VALUES ($1, $2, $3, $4, 'Operator 1')`,
      [pass1.id, s.id, chairCands[s.candidateIdx], box1.id]
    );
  }

  // Pass 2 (matching)
  const { rows: [pass2] } = await db.query(
    `INSERT INTO passes (round_id, pass_number, status, completed_at) VALUES ($1, 2, 'complete', NOW()) RETURNING id`,
    [round1.id]
  );
  for (const s of serials) {
    await db.query(
      `INSERT INTO scans (pass_id, ballot_serial_id, candidate_id, ballot_box_id, scanned_by)
       VALUES ($1, $2, $3, $4, 'Operator 2')`,
      [pass2.id, s.id, chairCands[s.candidateIdx], box1.id]
    );
  }

  // Store results
  const totalVotes = serials.length;
  const voteCounts = [6, 3, 1]; // Alice, Bob, Carol
  for (let i = 0; i < chairCands.length; i++) {
    const pct = (voteCounts[i] / totalVotes) * 100;
    await db.query(
      `INSERT INTO round_results (round_id, candidate_id, vote_count, percentage)
       VALUES ($1, $2, $3, $4)`,
      [round1.id, chairCands[i], voteCounts[i], pct.toFixed(5)]
    );
  }

  // Confirmation record
  await db.query(
    `INSERT INTO round_confirmations (round_id, confirmed_by_role, confirmed_by_name, is_override, override_notes)
     VALUES ($1, 'judge', 'Judge Smith', false, null)`,
    [round1.id]
  );

  console.log('Sample election seeded with scan data successfully.');
}

module.exports = { seed };

// Allow running directly: node src/seed.js
if (require.main === module) {
  require('dotenv').config();
  seed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}
