-- Migration 039: Electronic voting — admin and forward-compatibility
-- (Prompt H, stage H1; corresponds to the plan's "Migration 008".)

-- -----------------------------------------------------------------------------
-- admin_users: additive columns for the H7 password-based admin auth.
--
-- The plan's "Migration 008" specified CREATEing admin_users from scratch, but
-- the table already exists (migration 011) with PIN-based auth (name, pin_hash,
-- must_change_pin, role IN super_admin/race_admin). Per the H1 decision, this
-- migration EXTENDS it additively — existing rows and PIN login keep working;
-- H7 reconciles the auth model and role set on top of these columns.
-- -----------------------------------------------------------------------------
ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS email VARCHAR(255);

ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS session_timeout_minutes INTEGER NOT NULL DEFAULT 30;

ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- -----------------------------------------------------------------------------
-- admin_audit_log — append-only record of every admin action (H7 populates it
-- comprehensively; the table exists from H1 so later stages can write to it).
--
-- APPEND-ONLY: this repo connects with a single DB user that owns its tables,
-- so role-based REVOKE of UPDATE/DELETE cannot bind the owner. Append-only is
-- therefore enforced by a trigger that rejects any UPDATE or DELETE, plus a
-- REVOKE from PUBLIC for defense in depth. INSERT and SELECT remain allowed.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id             SERIAL PRIMARY KEY,
  admin_user_id  INTEGER REFERENCES admin_users(id),
  action         VARCHAR(100) NOT NULL,
  target_type    VARCHAR(50),
  target_id      INTEGER,
  details_json   JSONB,
  ip_address     VARCHAR(64),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created
  ON admin_audit_log (created_at);

CREATE OR REPLACE FUNCTION prevent_admin_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_log is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_admin_audit_log_append_only ON admin_audit_log;
CREATE TRIGGER trg_admin_audit_log_append_only
  BEFORE UPDATE OR DELETE ON admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION prevent_admin_audit_log_mutation();

REVOKE UPDATE, DELETE ON admin_audit_log FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- voter_race_eligibility — forward-compatibility schema for per-race voter
-- eligibility. SCHEMA ONLY in H1-H6: no UI populates it and no code writes to
-- it yet. The isVoterEligibleForRace() function (services/voterEligibility.js)
-- reads it from day one so the future eligibility feature drops in without a
-- refactor. Default behavior with an empty table is permissive (everyone
-- eligible).
--
-- ANONYMITY NOTE: this table links token_id <-> race_id only. Like
-- voter_race_participation, it must NEVER be joined to `votes`.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS voter_race_eligibility (
  id        SERIAL PRIMARY KEY,
  token_id  INTEGER NOT NULL REFERENCES voter_tokens(id) ON DELETE CASCADE,
  race_id   INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  eligible  BOOLEAN NOT NULL,
  UNIQUE (token_id, race_id)
);
