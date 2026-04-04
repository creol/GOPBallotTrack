-- 007_race_outcomes.sql
-- Track race outcomes: winner, advances, closed status

ALTER TABLE races ADD COLUMN IF NOT EXISTS outcome VARCHAR(30)
  CHECK (outcome IN ('winner', 'advances_next_round', 'advances_primary', 'closed'));
ALTER TABLE races ADD COLUMN IF NOT EXISTS outcome_candidate_id INTEGER REFERENCES candidates(id);
ALTER TABLE races ADD COLUMN IF NOT EXISTS outcome_notes TEXT;
ALTER TABLE races ADD COLUMN IF NOT EXISTS outcome_at TIMESTAMPTZ;

-- Add 'closed' to round status options
ALTER TABLE rounds DROP CONSTRAINT IF EXISTS rounds_status_check;
ALTER TABLE rounds ADD CONSTRAINT rounds_status_check
  CHECK (status IN ('pending', 'scanning', 'confirmed', 'pending_release', 'released', 'closed'));
