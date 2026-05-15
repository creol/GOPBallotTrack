-- Migration 038: Electronic voting — audit and lifecycle (Prompt H, stage H1)
-- (Corresponds to the plan's "Migration 007".)

-- -----------------------------------------------------------------------------
-- replacement_token_log — audit trail for the Chair-only replacement-token flow
-- (H3). When a voter loses/spoils a sticker, the chair revokes the old token
-- (if known) and activates a fresh one from the batch pool; every such action
-- is logged here. old_token_id is nullable because the voter may not know it.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS replacement_token_log (
  id             SERIAL PRIMARY KEY,
  event_id       INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  old_token_id   INTEGER REFERENCES voter_tokens(id),
  new_token_id   INTEGER NOT NULL REFERENCES voter_tokens(id),
  reason         TEXT NOT NULL,
  authorized_by  VARCHAR(255),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- races: reveal-authorization columns.
-- Records when (and by whom) the codes-to-candidates reveal / publish-to-
-- dashboard was authorized for an electronic race (H6).
-- -----------------------------------------------------------------------------
ALTER TABLE races
  ADD COLUMN IF NOT EXISTS reveal_authorized_at TIMESTAMPTZ;

ALTER TABLE races
  ADD COLUMN IF NOT EXISTS reveal_authorized_by VARCHAR(255);

-- -----------------------------------------------------------------------------
-- elections: credentialing window flag.
-- credentialing_open gates the Voter Activation flow (H3). It is mutually
-- exclusive with an open vote — the application enforces that interlock.
-- -----------------------------------------------------------------------------
ALTER TABLE elections
  ADD COLUMN IF NOT EXISTS credentialing_open BOOLEAN NOT NULL DEFAULT FALSE;
