-- 004_race_ballot_config.sql
-- Add ballot count and max rounds to races table

ALTER TABLE races ADD COLUMN IF NOT EXISTS ballot_count INTEGER;
ALTER TABLE races ADD COLUMN IF NOT EXISTS max_rounds INTEGER;
