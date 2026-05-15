-- Migration 037: Electronic voting — core tables (Prompt H, stage H1)
-- (Corresponds to the plan's "Migration 006". Numbers 006-008 were already
--  taken by the existing paper-ballot schema, so H1's three migrations land
--  at 037-039.)
--
-- =============================================================================
-- ANONYMITY BOUNDARY — READ BEFORE WRITING ANY QUERY AGAINST THESE TABLES
-- =============================================================================
-- Electronic voting anonymity rests on a strict three-table separation:
--
--   voter_tokens               — WHO is credentialed
--   voter_race_participation   — WHICH races a token took part in
--   votes                      — WHAT was chosen (serial + confirmation code)
--
-- These three tables MUST NEVER be joined to one another — not directly, and
-- not transitively via views, CTEs, subqueries, or application-level "fetch
-- from one, look up in another" logic. Joining them de-anonymizes voters and
-- breaks the entire privacy guarantee of the system.
--
-- The ONLY legitimate cross-table operation is the atomic INSERT performed at
-- vote-submission time (H4), which writes a row to votes and a row to
-- voter_race_participation inside a single transaction but never READS across
-- the boundary.
--
-- A dedicated low-privilege DB role (ballot_vote_writer, created at the bottom
-- of this migration) backstops this in the database itself: it can INSERT into
-- votes but has NO SELECT on votes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- voter_tokens — WHO is credentialed.
-- One row per pre-printed QR sticker token. Inert until a credentialer
-- activates it (H3). token_hash stores the hash (argon2/bcrypt) of the 6-char
-- token, never the plaintext. NEVER join this table to votes.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS voter_tokens (
  id            SERIAL PRIMARY KEY,
  event_id      INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  token_hash    VARCHAR(255) NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'unactivated'
                  CHECK (status IN ('unactivated', 'activated', 'revoked')),
  voter_type    VARCHAR(20)
                  CHECK (voter_type IS NULL OR voter_type IN ('in_person', 'remote')),
  activated_at  TIMESTAMPTZ,
  activated_by  VARCHAR(255),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voter_tokens_event_status
  ON voter_tokens (event_id, status);

-- -----------------------------------------------------------------------------
-- voter_race_participation — WHICH races a token took part in.
-- Records that a token has voted in a race, WITHOUT recording the choice.
-- The unique constraint on (token_id, race_id) enforces one vote per voter
-- per race. NEVER join this table to votes.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS voter_race_participation (
  id          SERIAL PRIMARY KEY,
  token_id    INTEGER NOT NULL REFERENCES voter_tokens(id) ON DELETE CASCADE,
  race_id     INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (token_id, race_id)
);

-- -----------------------------------------------------------------------------
-- votes — WHAT was chosen.
-- The anonymous vote record. NEVER join this table to voter_tokens or
-- voter_race_participation.
--
-- NOTE (H1 deviation): the plan's H1 deliverable list omits the `votes` table,
-- yet H1's DB-role requirement grants INSERT on it and H4 only ever INSERTs
-- into it (assuming it already exists). It is therefore created here so the
-- three-table anonymity foundation and the ballot_vote_writer grants are
-- complete in H1.
--
-- Deliberate omissions for anonymity:
--   * No submission timestamp — timing must not correlate a vote to a voter.
--     Arrival time is recorded separately in the server audit log (H4).
--   * Primary key is a random UUID, not a serial — a monotonic id would leak
--     insertion order, which is the same correlation risk as a timestamp.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS votes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  race_id            INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  serial             VARCHAR(64) NOT NULL,
  choice_id          INTEGER NOT NULL REFERENCES candidates(id),
  confirmation_code  VARCHAR(16) NOT NULL,
  UNIQUE (race_id, serial),
  UNIQUE (confirmation_code)
);

-- -----------------------------------------------------------------------------
-- sticker_batches — metadata for each generated batch of QR stickers (H2).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sticker_batches (
  id            SERIAL PRIMARY KEY,
  event_id      INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  batch_name    VARCHAR(255),
  count         INTEGER NOT NULL,
  size_preset   VARCHAR(50),
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_by  VARCHAR(255),
  notes         TEXT
);

-- -----------------------------------------------------------------------------
-- remote_serial_pool — pre-shuffled serials handed out to electronic voters.
-- Populated when a race opens (H5): N serials, randomly shuffled, each with a
-- position_in_shuffle. Vote submission (H4) pops the next available serial.
-- The shuffle is what anonymizes vote ordering on the votes table.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS remote_serial_pool (
  id                   SERIAL PRIMARY KEY,
  race_id              INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  serial               VARCHAR(64) NOT NULL,
  position_in_shuffle  INTEGER NOT NULL,
  status               VARCHAR(20) NOT NULL DEFAULT 'available'
                         CHECK (status IN ('available', 'used')),
  used_at              TIMESTAMPTZ,
  UNIQUE (race_id, serial)
);

CREATE INDEX IF NOT EXISTS idx_remote_serial_pool_pop
  ON remote_serial_pool (race_id, status, position_in_shuffle);

-- -----------------------------------------------------------------------------
-- races: electronic-voting columns.
-- voting_mode defaults to 'paper' so every existing race and the entire paper
-- ballot workflow is unaffected (cross-cutting principle: paper untouched).
-- -----------------------------------------------------------------------------
ALTER TABLE races
  ADD COLUMN IF NOT EXISTS voting_mode VARCHAR(20) NOT NULL DEFAULT 'paper'
    CHECK (voting_mode IN ('paper', 'electronic'));

ALTER TABLE races
  ADD COLUMN IF NOT EXISTS voter_pool_locked_at TIMESTAMPTZ;

ALTER TABLE races
  ADD COLUMN IF NOT EXISTS voter_pool_size INTEGER;

-- =============================================================================
-- ballot_vote_writer — least-privilege DB role for the vote-recording path.
--
-- H4's vote-submission code path connects as this role. It can write the three
-- things a vote submission needs and read only the minimum from voter_tokens —
-- crucially it has NO SELECT on votes, so even a compromised vote-submission
-- path cannot read back the anonymous vote records to de-anonymize voters.
--
-- Created NOLOGIN here; H4/H7 attach a password and point a connection pool at
-- it. Requires the migration's DB user to have CREATEROLE (true for the local
-- Docker postgres superuser and the RDS master user).
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ballot_vote_writer') THEN
    CREATE ROLE ballot_vote_writer NOLOGIN;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO ballot_vote_writer;

-- Column-scoped read on voter_tokens: only id, status, event_id — never the
-- token_hash, never voter_type, never who/when it was activated.
GRANT SELECT (id, status, event_id) ON voter_tokens TO ballot_vote_writer;

-- Write-only access to votes. No SELECT — see anonymity boundary above.
GRANT INSERT ON votes TO ballot_vote_writer;
REVOKE SELECT, UPDATE, DELETE ON votes FROM ballot_vote_writer;  -- defensive: make the intent explicit

GRANT INSERT ON voter_race_participation TO ballot_vote_writer;

GRANT SELECT, INSERT, UPDATE ON remote_serial_pool TO ballot_vote_writer;

-- Sequence usage for the SERIAL primary keys the role INSERTs into.
GRANT USAGE ON SEQUENCE voter_race_participation_id_seq TO ballot_vote_writer;
GRANT USAGE ON SEQUENCE remote_serial_pool_id_seq TO ballot_vote_writer;
