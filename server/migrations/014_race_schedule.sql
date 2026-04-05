-- Migration 014: Race schedule fields (date, time, location)
ALTER TABLE races ADD COLUMN IF NOT EXISTS race_date DATE;
ALTER TABLE races ADD COLUMN IF NOT EXISTS race_time TIME;
ALTER TABLE races ADD COLUMN IF NOT EXISTS location VARCHAR;
