-- Migration 030: One-time cleanup of reviewed_ballots orphaned by past pass deletions.
-- The pass-delete handler historically did not cascade to reviewed_ballots, leaving
-- review-queue entries pointing at soft-deleted passes. This migration reverses any
-- ballot_serials side-effects from resolved reviews and then deletes the orphans.
-- Going forward, DELETE /api/passes/:id cascades these inline.

-- Revert 'remade' originals (damaged -> unused) for orphaned reviews
UPDATE ballot_serials SET status = 'unused'
WHERE status = 'damaged' AND id IN (
  SELECT rb.original_serial_id FROM reviewed_ballots rb
  JOIN passes p ON p.id = rb.pass_id
  WHERE p.status = 'deleted' AND rb.outcome = 'remade'
);

-- Revert 'remade' replacements (counted -> unused) for orphaned reviews
UPDATE ballot_serials SET status = 'unused'
WHERE status = 'counted' AND id IN (
  SELECT rb.replacement_serial_id FROM reviewed_ballots rb
  JOIN passes p ON p.id = rb.pass_id
  WHERE p.status = 'deleted' AND rb.outcome = 'remade' AND rb.replacement_serial_id IS NOT NULL
);

-- Revert 'spoiled' originals (spoiled -> unused) for orphaned reviews
UPDATE ballot_serials SET status = 'unused'
WHERE status = 'spoiled' AND id IN (
  SELECT rb.original_serial_id FROM reviewed_ballots rb
  JOIN passes p ON p.id = rb.pass_id
  WHERE p.status = 'deleted' AND rb.outcome = 'spoiled'
);

-- Drop all reviewed_ballots tied to deleted passes
DELETE FROM reviewed_ballots
WHERE pass_id IN (SELECT id FROM passes WHERE status = 'deleted');
