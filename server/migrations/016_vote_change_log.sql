-- Migration 016: Vote change audit log
CREATE TABLE IF NOT EXISTS vote_changes (
  id              SERIAL PRIMARY KEY,
  scan_id         INTEGER NOT NULL REFERENCES scans(id),
  old_candidate_id INTEGER NOT NULL,
  new_candidate_id INTEGER NOT NULL,
  changed_by      VARCHAR NOT NULL,
  reason          TEXT,
  changed_at      TIMESTAMPTZ DEFAULT NOW()
);
