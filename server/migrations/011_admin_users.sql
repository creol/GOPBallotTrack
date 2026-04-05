-- Migration 011: Database-driven admin user system
-- Replaces PIN-from-.env auth with admin_users table

CREATE TABLE IF NOT EXISTS admin_users (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR NOT NULL UNIQUE,
  role            VARCHAR NOT NULL CHECK (role IN ('super_admin', 'race_admin')),
  pin_hash        VARCHAR NOT NULL,
  must_change_pin BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS race_admin_assignments (
  id             SERIAL PRIMARY KEY,
  race_id        INTEGER NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  admin_user_id  INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  assigned_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(race_id, admin_user_id)
);
