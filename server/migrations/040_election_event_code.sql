-- Migration 040: Election event_code + voter_tokens uniqueness (Prompt H, stage H2)
--
-- H1's schema did not include an event_code, but the voter-facing URL
-- (https://vote.<domain>/<event_code>/?t=<token>) and the QR stickers (H2)
-- need a short, stable, human-friendly code per election. This migration
-- adds it and backfills existing elections.

-- elections.event_code — short code used in the voter URL path.
ALTER TABLE elections
  ADD COLUMN IF NOT EXISTS event_code VARCHAR(16);

-- Backfill existing elections with a deterministic, guaranteed-unique code.
-- New elections get a random 6-char code from the app (services/eventCode.js);
-- the format difference is cosmetic — both are just unique URL path segments.
UPDATE elections
  SET event_code = 'EVT' || LPAD(id::TEXT, 5, '0')
  WHERE event_code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_elections_event_code
  ON elections (event_code);

-- voter_tokens uniqueness: HMAC-SHA256 token hashing is deterministic, so a
-- duplicate token within an event would collide to the same hash. This unique
-- index makes "no duplicate token per event" a hard DB guarantee and lets the
-- batch generator detect collisions even under concurrent generation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_voter_tokens_event_hash
  ON voter_tokens (event_id, token_hash);
