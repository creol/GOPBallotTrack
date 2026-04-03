-- 006_scanner_box_assignment.sql
-- Track which ballot box each scanner is currently scanning from

ALTER TABLE scanners ADD COLUMN IF NOT EXISTS current_box_id INTEGER REFERENCES ballot_boxes(id);
