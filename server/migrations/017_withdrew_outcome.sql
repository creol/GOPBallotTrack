-- Migration 017: Add 'withdrew' to round_results outcome CHECK constraint
ALTER TABLE round_results DROP CONSTRAINT IF EXISTS round_results_outcome_check;
ALTER TABLE round_results ADD CONSTRAINT round_results_outcome_check
  CHECK (outcome IN ('eliminated', 'withdrew', 'advance', 'convention_winner', 'winner', 'advance_to_primary'));
