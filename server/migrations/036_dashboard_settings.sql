-- Per-election dashboard customization (layout mode, rotation, branding, colors).
-- Single JSONB blob keeps the schema stable as the admin UI grows.
ALTER TABLE elections
  ADD COLUMN IF NOT EXISTS dashboard_settings JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Globally-reusable dashboard templates (a saved settings snapshot the operator can
-- apply to any election). Name is unique so the admin UI can present a clean list.
CREATE TABLE IF NOT EXISTS dashboard_templates (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(128) NOT NULL UNIQUE,
  settings    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);
