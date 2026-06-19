-- 0011_matter_assignments.sql
-- Creates matter_assignments: who can go INSIDE a matter (files, research,
-- case chat, edit). Firm members see the card; only rows here grant inside access.
-- Additive and idempotent. Structure only — backfill is a separate step.

CREATE TABLE IF NOT EXISTS matter_assignments (
  matter_id     uuid NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_by   uuid REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (matter_id, user_id)
);

CREATE INDEX IF NOT EXISTS matter_assignments_user_id_idx
  ON matter_assignments (user_id);

CREATE INDEX IF NOT EXISTS matter_assignments_matter_id_idx
  ON matter_assignments (matter_id);