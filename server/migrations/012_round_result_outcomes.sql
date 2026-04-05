-- Migration 012: Candidate round outcomes for Control Center
ALTER TABLE round_results ADD COLUMN IF NOT EXISTS outcome VARCHAR
  CHECK (outcome IN ('eliminated', 'advance', 'convention_winner', 'winner', 'advance_to_primary'));
