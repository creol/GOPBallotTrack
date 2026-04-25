-- ============================================================================
-- Cleanup script: erase contaminating scans from round 209.
--
-- Background: a scanner station was assigned to the original-event round 209
-- (election 12, race 74) instead of the cloned-event round 377 (election 17,
-- race 137). Three ballots were uploaded into round 209. Older code auto-
-- opened a pass and flipped the round to 'tallying' on the first scan; we
-- need to erase every artifact so the official round is back to its
-- pre-contamination state and the pre-printed ballots remain valid.
--
-- USAGE:
--   1. Connect to the production database:
--        psql "$DATABASE_URL"
--   2. \i /path/to/cleanup_round_209.sql
--   3. Inspect the BEFORE / AFTER counts that print.
--   4. If the counts look right, replace the trailing ROLLBACK with COMMIT
--      and re-run. (Or just run COMMIT manually inside the same session.)
--
-- This is a one-shot recovery script — leave it in source for the audit
-- trail but do not re-run it after the COMMIT.
-- ============================================================================

\set TARGET_ROUND 209

BEGIN;

-- Sanity check: confirm the round we're about to clean is what we expect.
\echo '--- Target round ---'
SELECT r.id AS round_id, r.round_number, r.status,
       ra.id AS race_id, ra.name AS race_name,
       e.id AS election_id, e.name AS election_name
FROM rounds r
JOIN races ra ON r.race_id = ra.id
JOIN elections e ON ra.election_id = e.id
WHERE r.id = :TARGET_ROUND;

\echo '--- BEFORE row counts ---'
SELECT 'passes'           AS table_name, COUNT(*) FROM passes           WHERE round_id = :TARGET_ROUND
UNION ALL SELECT 'scans',           COUNT(*) FROM scans s JOIN passes p ON p.id = s.pass_id WHERE p.round_id = :TARGET_ROUND
UNION ALL SELECT 'reviewed_ballots',COUNT(*) FROM reviewed_ballots WHERE round_id = :TARGET_ROUND
UNION ALL SELECT 'scan_uploads',    COUNT(*) FROM scan_uploads     WHERE round_id = :TARGET_ROUND
UNION ALL SELECT 'scan_logs',       COUNT(*) FROM scan_logs        WHERE round_id = :TARGET_ROUND
UNION ALL SELECT 'round_results',   COUNT(*) FROM round_results    WHERE round_id = :TARGET_ROUND
UNION ALL SELECT 'round_confirmations', COUNT(*) FROM round_confirmations WHERE round_id = :TARGET_ROUND
UNION ALL SELECT 'ballot_serials_counted', COUNT(*) FROM ballot_serials   WHERE round_id = :TARGET_ROUND AND status = 'counted'
UNION ALL SELECT 'ballot_serials_spoiled', COUNT(*) FROM ballot_serials   WHERE round_id = :TARGET_ROUND AND status = 'spoiled';

\echo '--- File paths to remove from disk (front/back/processed images) ---'
SELECT s.id AS scan_id, bs.serial_number, s.image_path, s.front_image_path, s.back_image_path
FROM scans s
JOIN passes p ON p.id = s.pass_id
LEFT JOIN ballot_serials bs ON bs.id = s.ballot_serial_id
WHERE p.round_id = :TARGET_ROUND;

SELECT id AS reviewed_id, image_path, photo_path
FROM reviewed_ballots
WHERE round_id = :TARGET_ROUND;

-- ----------------------------------------------------------------------------
-- Cleanup (order matters because of FK constraints).
-- ----------------------------------------------------------------------------

DELETE FROM round_results       WHERE round_id = :TARGET_ROUND;
DELETE FROM round_confirmations WHERE round_id = :TARGET_ROUND;
DELETE FROM scan_uploads        WHERE round_id = :TARGET_ROUND;
DELETE FROM reviewed_ballots    WHERE round_id = :TARGET_ROUND;
DELETE FROM scans               WHERE pass_id IN (SELECT id FROM passes WHERE round_id = :TARGET_ROUND);
DELETE FROM passes              WHERE round_id = :TARGET_ROUND;
DELETE FROM scan_logs           WHERE round_id = :TARGET_ROUND;

-- Reset every serial in this round to 'unused' so the printed ballots are
-- valid again. Anything not 'unused' is contamination from this incident.
UPDATE ballot_serials
   SET status = 'unused'
 WHERE round_id = :TARGET_ROUND
   AND status <> 'unused';

-- Force the round back to the canonical pre-voting state in case any
-- transition timestamps got set.
UPDATE rounds
   SET status         = 'ready',
       published_at   = NULL,
       confirmed_by   = NULL,
       confirmed_at   = NULL,
       released_by    = NULL,
       released_at    = NULL
 WHERE id = :TARGET_ROUND;

-- ----------------------------------------------------------------------------
-- Verification
-- ----------------------------------------------------------------------------

\echo '--- AFTER row counts (every value should be 0 except ballot_serials_unused) ---'
SELECT 'passes'           AS table_name, COUNT(*) FROM passes           WHERE round_id = :TARGET_ROUND
UNION ALL SELECT 'scans',           COUNT(*) FROM scans s JOIN passes p ON p.id = s.pass_id WHERE p.round_id = :TARGET_ROUND
UNION ALL SELECT 'reviewed_ballots',COUNT(*) FROM reviewed_ballots WHERE round_id = :TARGET_ROUND
UNION ALL SELECT 'scan_uploads',    COUNT(*) FROM scan_uploads     WHERE round_id = :TARGET_ROUND
UNION ALL SELECT 'scan_logs',       COUNT(*) FROM scan_logs        WHERE round_id = :TARGET_ROUND
UNION ALL SELECT 'round_results',   COUNT(*) FROM round_results    WHERE round_id = :TARGET_ROUND
UNION ALL SELECT 'round_confirmations', COUNT(*) FROM round_confirmations WHERE round_id = :TARGET_ROUND
UNION ALL SELECT 'ballot_serials_counted', COUNT(*) FROM ballot_serials   WHERE round_id = :TARGET_ROUND AND status = 'counted'
UNION ALL SELECT 'ballot_serials_spoiled', COUNT(*) FROM ballot_serials   WHERE round_id = :TARGET_ROUND AND status = 'spoiled'
UNION ALL SELECT 'ballot_serials_unused',  COUNT(*) FROM ballot_serials   WHERE round_id = :TARGET_ROUND AND status = 'unused';

\echo '--- Round state after cleanup ---'
SELECT id, status, published_at, confirmed_at, released_at
FROM rounds WHERE id = :TARGET_ROUND;

-- Default to ROLLBACK so a dry run is safe. Replace with COMMIT once the
-- BEFORE/AFTER counts have been reviewed.
ROLLBACK;
-- COMMIT;
