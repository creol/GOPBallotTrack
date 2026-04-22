-- Per-race toggle to hide a race from the public dashboard overview.
-- Individual ballot SN lookups (public_search_enabled) are controlled separately.
ALTER TABLE races ADD COLUMN IF NOT EXISTS dashboard_visible BOOLEAN NOT NULL DEFAULT true;
