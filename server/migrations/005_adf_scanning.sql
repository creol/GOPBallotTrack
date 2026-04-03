-- 005_adf_scanning.sql
-- ADF scanner support: scanners, flagged ballots, and OMR metadata on scans

-- Scanners
CREATE TABLE IF NOT EXISTS scanners (
  id SERIAL PRIMARY KEY,
  election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  watch_folder_path TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Flagged Ballots
CREATE TABLE IF NOT EXISTS flagged_ballots (
  id SERIAL PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  pass_id INTEGER REFERENCES passes(id),
  ballot_serial_id INTEGER REFERENCES ballot_serials(id),
  scanner_id INTEGER REFERENCES scanners(id),
  flag_reason VARCHAR(30) NOT NULL
    CHECK (flag_reason IN ('no_mark', 'overvote', 'uncertain', 'qr_not_found')),
  image_path TEXT,
  omr_scores JSONB,
  reviewed_by VARCHAR(255),
  review_decision VARCHAR(20)
    CHECK (review_decision IN ('counted', 'spoiled', 'rejected')),
  review_candidate_id INTEGER REFERENCES candidates(id),
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

-- Add ADF/OMR columns to scans (keep existing front_image_path and back_image_path)
ALTER TABLE scans ADD COLUMN IF NOT EXISTS image_path TEXT;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS scanner_id INTEGER REFERENCES scanners(id);
ALTER TABLE scans ADD COLUMN IF NOT EXISTS omr_confidence DECIMAL(5,4);
ALTER TABLE scans ADD COLUMN IF NOT EXISTS omr_method VARCHAR(20) DEFAULT 'manual'
  CHECK (omr_method IN ('auto', 'manual_review', 'manual'));
