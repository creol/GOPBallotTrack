-- 002_tv_qr_columns.sql
-- Add TV QR code toggle columns to elections

ALTER TABLE elections ADD COLUMN IF NOT EXISTS tv_qr_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE elections ADD COLUMN IF NOT EXISTS tv_qr_url TEXT;
