-- Migration 015: Add manual_correction to omr_method CHECK constraint
ALTER TABLE scans DROP CONSTRAINT IF EXISTS scans_omr_method_check;
ALTER TABLE scans ADD CONSTRAINT scans_omr_method_check
  CHECK (omr_method IN ('auto', 'manual_review', 'manual', 'manual_correction'));
