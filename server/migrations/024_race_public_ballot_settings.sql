-- Per-race settings for public ballot search and browse
ALTER TABLE races ADD COLUMN IF NOT EXISTS public_search_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE races ADD COLUMN IF NOT EXISTS public_browse_enabled BOOLEAN NOT NULL DEFAULT false;
