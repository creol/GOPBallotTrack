-- Election-level settings for public ballot search and browse
ALTER TABLE elections ADD COLUMN IF NOT EXISTS public_search_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE elections ADD COLUMN IF NOT EXISTS public_browse_enabled BOOLEAN NOT NULL DEFAULT false;
