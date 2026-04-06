-- Migration 018: Allow reviewed_ballots without a known serial number
-- Needed for QR-not-found cases where the ballot image is saved for review
-- but the serial number hasn't been identified yet.

ALTER TABLE reviewed_ballots ALTER COLUMN original_serial_id DROP NOT NULL;
