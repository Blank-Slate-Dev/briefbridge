-- 0012_firm_tables_rls.sql
-- ============================================================================
-- Adds RLS policies to the three firm-collaboration tables that were created
-- RLS-enabled but with ZERO policies (firms, firm_memberships,
-- matter_assignments). "RLS enabled + no policy" = deny-all, which is a latent
-- landmine the moment anything connects as a non-bypass role.
--
-- These policies are written against auth.uid() (the Supabase JWT user), to
-- MATCH the existing _own policies on matters/files/conversations/messages.
--
-- IMPORTANT — these policies are DORMANT today:
--   The app connects via Drizzle as the `postgres` role, which has BYPASSRLS.
--   So like every other policy in this DB, these are bypassed and inert until
--   a future re-architecture switches the app to a non-bypass role + per-
--   request identity. This migration ONLY removes the firm tables' special
--   "enabled-but-no-policy" inconsistency. It changes no runtime behaviour.
--
-- See SECURITY.md for the full RLS re-architecture plan (JWT vs session var).
--
-- Idempotent: DROP POLICY IF EXISTS before each CREATE.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- firms
--   A user may SEE a firm row if they are a member of it.
--   Writes (INSERT/UPDATE/DELETE) are intentionally NOT granted to the
--   JWT user here — firm creation/management happens through trusted
--   server-side flows (service role / superuser), not direct client writes.
--   When the re-architecture lands, revisit whether owners get UPDATE.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS firms_select_member ON firms;
CREATE POLICY firms_select_member ON firms
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM firm_memberships m
      WHERE m.firm_id = firms.id
        AND m.user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- firm_memberships
--   A user may SEE membership rows for any firm they belong to (so they can
--   see who else is in their firm). Matches "see my firm's members".
--   Writes remain server-side (invites/role changes go through trusted flows).
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS firm_memberships_select_same_firm ON firm_memberships;
CREATE POLICY firm_memberships_select_same_firm ON firm_memberships
  FOR SELECT
  USING (
    firm_id IN (
      SELECT m.firm_id FROM firm_memberships m
      WHERE m.user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- matter_assignments
--   A user may SEE assignment rows for matters in their firm (so the card
--   directory can show who's assigned to what). Scoped through the matter's
--   firm_id joined to the user's membership.
--   Writes (assign/unassign) remain server-side through trusted flows.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS matter_assignments_select_firm ON matter_assignments;
CREATE POLICY matter_assignments_select_firm ON matter_assignments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM matters mt
      JOIN firm_memberships m ON m.firm_id = mt.firm_id
      WHERE mt.id = matter_assignments.matter_id
        AND m.user_id = auth.uid()
    )
  );

-- ============================================================================
-- NOTE: No connection-role change here. Drizzle still connects as `postgres`
-- (BYPASSRLS), so these are dormant. This migration only makes the three firm
-- tables consistent with the rest of the schema (which is also RLS-enabled +
-- dormant). The real activation is the deferred re-architecture in SECURITY.md.
-- ============================================================================