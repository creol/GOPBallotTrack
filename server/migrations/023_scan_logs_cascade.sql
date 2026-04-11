-- Migration 023: Fix scan_logs FK to allow election hard-delete
-- scan_logs.election_id is nullable, so SET NULL is appropriate —
-- keeps diagnostic logs but removes the association when election is deleted.
ALTER TABLE scan_logs DROP CONSTRAINT IF EXISTS scan_logs_election_id_fkey;
ALTER TABLE scan_logs ADD CONSTRAINT scan_logs_election_id_fkey
  FOREIGN KEY (election_id) REFERENCES elections(id) ON DELETE SET NULL;
