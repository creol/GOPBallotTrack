-- Migration 021: Add wrong_round_pending to omr_method for cross-round ballot tracking
ALTER TABLE scans DROP CONSTRAINT IF EXISTS scans_omr_method_check;
ALTER TABLE scans ADD CONSTRAINT scans_omr_method_check
  CHECK (omr_method IN ('auto', 'manual_review', 'manual', 'manual_correction', 'wrong_round_pending'));
