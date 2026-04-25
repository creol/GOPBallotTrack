-- Migration 032: Per-candidate final designation set when generating the official
-- Race Summary PDF. Existing races.outcome / races.outcome_candidate_id support
-- only a single outcome candidate; this column lets multiple candidates per race
-- carry an authoritative status. Mutually exclusive: 'official_nominee' or
-- 'progress_to_primary'. NULL means no designation.

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS final_designation TEXT
  CHECK (final_designation IS NULL OR final_designation IN ('official_nominee', 'progress_to_primary'));
