-- Migration 035: Cascade vote_changes when a scan is deleted.
-- Without this, deleting a pass fails when any scan in the pass had its
-- candidate rewritten during reconciliation (an entry in vote_changes).
-- vote_changes is an audit log keyed to scan_id; once the scan is gone the
-- audit row is orphaned data, so CASCADE is the appropriate behavior.
ALTER TABLE vote_changes DROP CONSTRAINT IF EXISTS vote_changes_scan_id_fkey;
ALTER TABLE vote_changes ADD CONSTRAINT vote_changes_scan_id_fkey
  FOREIGN KEY (scan_id) REFERENCES scans(id) ON DELETE CASCADE;
