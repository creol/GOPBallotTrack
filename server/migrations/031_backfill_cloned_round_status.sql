-- Migration 031: One-time backfill for rounds that were created via the clone/import
-- path before testTools.js was fixed to advance status from 'pending_needs_action' to
-- 'ready' when a ballots.pdf was copied. Without this, cloned events landed with
-- ballot files on disk but no UI control to progress the round (no "Open Voting" button).
-- See server/src/routes/testTools.js (clone import) and server/src/routes/ballots.js
-- (which already does this transition during normal generation).

UPDATE rounds
   SET status = 'ready'
 WHERE status = 'pending_needs_action'
   AND ballot_pdf_path IS NOT NULL;
