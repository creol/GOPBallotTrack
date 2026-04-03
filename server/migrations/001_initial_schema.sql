-- 001_initial_schema.sql
-- BallotTrack Phase 1: Full database schema

CREATE TABLE IF NOT EXISTS _migrations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Elections
CREATE TABLE IF NOT EXISTS elections (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  date DATE NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived', 'deleted')),
  is_sample BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Races
CREATE TABLE IF NOT EXISTS races (
  id SERIAL PRIMARY KEY,
  election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  threshold_type VARCHAR(20) NOT NULL DEFAULT 'majority'
    CHECK (threshold_type IN ('majority', 'two_thirds', 'custom')),
  threshold_value DECIMAL(10,5),
  display_order INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'complete')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Candidates
CREATE TABLE IF NOT EXISTS candidates (
  id SERIAL PRIMARY KEY,
  race_id INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'withdrawn')),
  withdrawn_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rounds
CREATE TABLE IF NOT EXISTS rounds (
  id SERIAL PRIMARY KEY,
  race_id INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  paper_color VARCHAR(50),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'scanning', 'confirmed', 'pending_release', 'released')),
  confirmed_by VARCHAR(255),
  confirmed_at TIMESTAMPTZ,
  released_by VARCHAR(255),
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ballot Serials
CREATE TABLE IF NOT EXISTS ballot_serials (
  id SERIAL PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  serial_number VARCHAR(64) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'unused'
    CHECK (status IN ('unused', 'counted', 'spoiled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT serial_number_min_length CHECK (char_length(serial_number) >= 8)
);

-- Ballot Boxes
CREATE TABLE IF NOT EXISTS ballot_boxes (
  id SERIAL PRIMARY KEY,
  election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Passes
CREATE TABLE IF NOT EXISTS passes (
  id SERIAL PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  pass_number INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'complete', 'deleted')),
  deleted_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Scans
CREATE TABLE IF NOT EXISTS scans (
  id SERIAL PRIMARY KEY,
  pass_id INTEGER NOT NULL REFERENCES passes(id) ON DELETE CASCADE,
  ballot_serial_id INTEGER NOT NULL REFERENCES ballot_serials(id),
  candidate_id INTEGER NOT NULL REFERENCES candidates(id),
  ballot_box_id INTEGER REFERENCES ballot_boxes(id),
  scanned_by VARCHAR(255),
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  front_image_path TEXT,
  back_image_path TEXT
);

-- Spoiled Ballots
CREATE TABLE IF NOT EXISTS spoiled_ballots (
  id SERIAL PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  ballot_serial_id INTEGER NOT NULL REFERENCES ballot_serials(id),
  spoil_type VARCHAR(30) NOT NULL
    CHECK (spoil_type IN ('unreadable', 'intent_undermined')),
  notes TEXT,
  image_path TEXT,
  reported_by VARCHAR(255),
  confirmed_by VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Round Confirmations
CREATE TABLE IF NOT EXISTS round_confirmations (
  id SERIAL PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  confirmed_by_role VARCHAR(20) NOT NULL
    CHECK (confirmed_by_role IN ('judge', 'chair')),
  confirmed_by_name VARCHAR(255) NOT NULL,
  is_override BOOLEAN NOT NULL DEFAULT FALSE,
  override_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Round Results
CREATE TABLE IF NOT EXISTS round_results (
  id SERIAL PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id),
  vote_count INTEGER NOT NULL DEFAULT 0,
  percentage DECIMAL(10,5) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
