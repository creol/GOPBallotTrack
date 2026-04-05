-- Migration 010: Per-round ballot design overrides and generation tracking
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS ballot_pdf_generated_at TIMESTAMPTZ;
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS ballot_pdf_path VARCHAR;
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS ballot_design_overrides JSONB;
