const fs = require('fs');
const path = require('path');
const db = require('./db');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function runMigrations() {
  // Ensure the _migrations tracking table exists
  await db.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Get already-applied migrations
  const { rows: applied } = await db.query('SELECT name FROM _migrations ORDER BY id');
  const appliedSet = new Set(applied.map((r) => r.name));

  // Read migration files sorted by name
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`Migration already applied: ${file}`);
      continue;
    }

    console.log(`Applying migration: ${file}`);
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

    // Skip the _migrations CREATE TABLE statement since we already created it
    const filtered = sql.replace(
      /CREATE TABLE IF NOT EXISTS _migrations[^;]+;/s,
      ''
    );

    await db.query(filtered);
    await db.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
    console.log(`Migration applied: ${file}`);
  }

  console.log('All migrations up to date.');
}

module.exports = { runMigrations };

// Allow running directly: node src/migrate.js
if (require.main === module) {
  require('dotenv').config();
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
