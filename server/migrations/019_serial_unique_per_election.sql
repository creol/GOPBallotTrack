-- Change serial_number uniqueness from global to per-round
-- This allows the same SN to exist in different elections (e.g., after import)
-- SNs remain unique within each election since each election has its own rounds
ALTER TABLE ballot_serials DROP CONSTRAINT IF EXISTS ballot_serials_serial_number_key;
ALTER TABLE ballot_serials ADD CONSTRAINT ballot_serials_round_serial_unique UNIQUE (round_id, serial_number);
