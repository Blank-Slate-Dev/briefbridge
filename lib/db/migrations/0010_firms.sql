-- 0010_firms.sql
-- Creates firms + firm_memberships tables, and adds matters.firm_id (nullable).
-- All additive and idempotent (IF NOT EXISTS). Safe to run on the live DB.
-- Structure only — no data backfill (that's a separate step).

CREATE TABLE IF NOT EXISTS firms (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  plan          text NOT NULL DEFAULT 'trial',
  seats         integer NOT NULL DEFAULT 1,
  email_domain  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT firms_plan_check
    CHECK (plan IN ('trial', 'active', 'past_due', 'cancelled')),
  CONSTRAINT firms_seats_check CHECK (seats >= 1)
);

CREATE TABLE IF NOT EXISTS firm_memberships (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     uuid NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT firm_memberships_role_check
    CHECK (role IN ('owner', 'admin', 'lawyer', 'paralegal'))
);

CREATE INDEX IF NOT EXISTS firm_memberships_firm_id_idx
  ON firm_memberships (firm_id);

CREATE UNIQUE INDEX IF NOT EXISTS firm_memberships_user_id_unique
  ON firm_memberships (user_id);

ALTER TABLE matters
  ADD COLUMN IF NOT EXISTS firm_id uuid REFERENCES firms(id);

CREATE INDEX IF NOT EXISTS matters_firm_id_idx
  ON matters (firm_id);