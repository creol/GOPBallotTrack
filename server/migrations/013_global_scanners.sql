-- Migration 013: Make scanners global (not tied to an election)
-- Drop election_id requirement so scanners are shared across all events
ALTER TABLE scanners ALTER COLUMN election_id DROP NOT NULL;

-- Clear existing scanners (they'll be re-seeded as global)
DELETE FROM scanners;
