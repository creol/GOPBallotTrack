-- Migration 008: Reviewed Ballot System
-- Replaces both spoiled_ballots and flagged_ballots with unified reviewed_ballots table

-- 1. Drop old tables
DROP TABLE IF EXISTS spoiled_ballots CASCADE;
DROP TABLE IF EXISTS flagged_ballots CASCADE;

-- 2. Update ballot_serials status constraint
ALTER TABLE ballot_serials DROP CONSTRAINT IF EXISTS ballot_serials_status_check;
ALTER TABLE ballot_serials ADD CONSTRAINT ballot_serials_status_check
  CHECK (status IN ('unused', 'counted', 'damaged', 'remade', 'spoiled'));

-- 3. Create reviewed_ballots table
CREATE TABLE IF NOT EXISTS reviewed_ballots (
  id                    SERIAL PRIMARY KEY,
  round_id              INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  pass_id               INTEGER REFERENCES passes(id),
  original_serial_id    INTEGER NOT NULL REFERENCES ballot_serials(id),
  replacement_serial_id INTEGER REFERENCES ballot_serials(id),
  scanner_id            INTEGER REFERENCES scanners(id),
  outcome               VARCHAR CHECK (outcome IN ('remade', 'spoiled', 'counted', 'rejected')),
  flag_reason           VARCHAR,
  omr_scores            JSONB,
  notes                 TEXT,
  photo_path            VARCHAR,
  image_path            VARCHAR,
  reviewed_by           VARCHAR,
  reviewed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_reviewed_ballots_round ON reviewed_ballots(round_id);
CREATE INDEX IF NOT EXISTS idx_reviewed_ballots_outcome ON reviewed_ballots(outcome);
