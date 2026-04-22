-- Pass deletion audit entries insert into status_transitions with entity_type='pass_deleted'.
-- The original CHECK constraint only allowed 'race' and 'round', so those inserts threw and
-- rolled back the API response with 500 — but the earlier UPDATE that soft-deleted the pass
-- had already committed (the delete handler was not transactional). The pass "disappeared"
-- while the UI showed an error. Extend the constraint to allow the extra entity types the
-- code actually uses.
ALTER TABLE status_transitions DROP CONSTRAINT IF EXISTS status_transitions_entity_type_check;
ALTER TABLE status_transitions ADD CONSTRAINT status_transitions_entity_type_check
  CHECK (entity_type IN ('race', 'round', 'pass', 'pass_deleted', 'pass_reopened'));
