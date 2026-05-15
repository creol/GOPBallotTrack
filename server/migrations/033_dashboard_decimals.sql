-- Per-election control for how many decimal places dashboards display on percentages.
-- Values are always truncated (never rounded). Range 0-5 (DECIMAL(10,5) source precision).
ALTER TABLE elections
  ADD COLUMN IF NOT EXISTS dashboard_decimals INTEGER NOT NULL DEFAULT 3
  CHECK (dashboard_decimals BETWEEN 0 AND 5);
