-- Migration 009: Race & Round Status Overhaul
-- Replaces all race and round status values. Test data wiped.

-- 1. Race status overhaul
ALTER TABLE races DROP CONSTRAINT IF EXISTS races_status_check;
UPDATE races SET status = 'pending_needs_action';
ALTER TABLE races ALTER COLUMN status SET DEFAULT 'pending_needs_action';
ALTER TABLE races ADD CONSTRAINT races_status_check
  CHECK (status IN ('pending_needs_action', 'ready', 'in_progress', 'results_finalized'));

-- 2. Round status overhaul
ALTER TABLE rounds DROP CONSTRAINT IF EXISTS rounds_status_check;
UPDATE rounds SET status = 'pending_needs_action';
ALTER TABLE rounds ALTER COLUMN status SET DEFAULT 'pending_needs_action';
ALTER TABLE rounds ADD CONSTRAINT rounds_status_check
  CHECK (status IN ('pending_needs_action', 'ready', 'voting_open', 'voting_closed', 'tallying', 'round_finalized', 'canceled'));

-- 3. Published gate column — set ONLY by Control Center publish action
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;

-- 4. Status transition timing table (admin-only analytics)
CREATE TABLE IF NOT EXISTS status_transitions (
  id               SERIAL PRIMARY KEY,
  entity_type      VARCHAR NOT NULL CHECK (entity_type IN ('race', 'round')),
  entity_id        INTEGER NOT NULL,
  from_status      VARCHAR,
  to_status        VARCHAR NOT NULL,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at         TIMESTAMPTZ,
  duration_seconds INTEGER,
  changed_by       VARCHAR,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_status_transitions_entity ON status_transitions(entity_type, entity_id);
