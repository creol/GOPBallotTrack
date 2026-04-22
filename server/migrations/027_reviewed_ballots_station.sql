-- Track which station originated each reviewed ballot so the round admin page
-- can show "images needing reconciliation" broken down by station.
ALTER TABLE reviewed_ballots ADD COLUMN IF NOT EXISTS station_id VARCHAR(64);
CREATE INDEX IF NOT EXISTS idx_reviewed_ballots_station ON reviewed_ballots(station_id);
