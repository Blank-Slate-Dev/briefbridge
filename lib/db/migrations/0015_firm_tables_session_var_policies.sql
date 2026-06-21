-- 0015_firm_tables_session_var_policies.sql
-- ============================================================================
-- STEP (RLS Path A): session-variable policies for the THREE firm tables.
--
-- Migration 0014 added session-variable policies to the user-data tables
-- (matters/files/conversations/messages/profiles/file_tags). The firm tables
-- (firms / firm_memberships / matter_assignments) were MISSED — they only have
-- the auth.uid()-based policies from 0012, which are null on the Drizzle
-- connection. After cutover, access.ts queries against these tables would hit
-- RLS with no matching session-variable policy → deny → firm checks all fail.
--
-- This closes that gap. These policies are ADDITIVE and coexist with the 0012
-- auth.uid() policies (Postgres ORs permissive policies). DORMANT today (the
-- app still connects as `postgres`/BYPASSRLS).
--
-- DESIGN: OPTION A — minimal / own-rows-only / NON-RECURSIVE.
--   access.ts's three functions all query by "my own user_id":
--     - getUserFirmMembership: firm_memberships WHERE user_id = me
--     - userCanSeeMatterCard:  matters JOIN firm_memberships WHERE fm.user_id = me
--     - userCanAccessMatter:   matter_assignments WHERE user_id = me
--   So an own-rows policy (user_id = current_setting('app.user_id')) is
--   sufficient for everything the app does TODAY.
--
--   We deliberately do NOT replicate 0012's "see all members of my firm"
--   visibility, because:
--     (a) nothing currently needs it (no member-management UI yet), and
--     (b) the 0012 firm_memberships policy SELF-REFERENCES firm_memberships
--         (firm_id IN (SELECT firm_id FROM firm_memberships ...)), which risks
--         RLS infinite-recursion under a non-bypass role. The own-rows form
--         avoids any subquery into the same table — no recursion possible.
--
--   When Slice 4 (member management) needs "see all firm members", add that
--   wider policy THEN, written carefully to avoid the recursion trap (e.g.
--   via a SECURITY DEFINER helper function or a non-recursive formulation).
--
-- firms: access.ts does not SELECT firms directly today, but getUserFirmMembership
--   returns firmId which callers use. We add an own-firm policy so a future
--   direct read of the user's firm row works: visible if the firm has a
--   membership row for me. This subquery hits firm_memberships (a DIFFERENT
--   table), so no self-recursion.
--
-- Run each block separately in the SQL editor (select-all per block).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- firm_memberships — own rows only. NON-RECURSIVE (no subquery into self).
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS firm_memberships_select_sessvar ON firm_memberships;
CREATE POLICY firm_memberships_select_sessvar ON firm_memberships
  FOR SELECT
  USING (user_id = current_setting('app.user_id', true)::uuid);

-- ----------------------------------------------------------------------------
-- matter_assignments — own rows only. NON-RECURSIVE.
-- (userCanAccessMatter reads the caller's own assignment row.)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS matter_assignments_select_sessvar ON matter_assignments;
CREATE POLICY matter_assignments_select_sessvar ON matter_assignments
  FOR SELECT
  USING (user_id = current_setting('app.user_id', true)::uuid);

-- ----------------------------------------------------------------------------
-- firms — visible if the current user has a membership in this firm.
-- Subquery targets firm_memberships (different table) → no self-recursion.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS firms_select_sessvar ON firms;
CREATE POLICY firms_select_sessvar ON firms
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM firm_memberships m
      WHERE m.firm_id = firms.id
        AND m.user_id = current_setting('app.user_id', true)::uuid
    )
  );

-- ============================================================================
-- NOTE on userCanSeeMatterCard: it JOINs matters → firm_memberships. The
-- matters side is covered by the matters session-var policy (0014); the
-- firm_memberships side is now covered by firm_memberships_select_sessvar
-- above. BUT: that own-rows policy only exposes the CALLER'S OWN membership
-- row — which is exactly what the JOIN needs (it matches fm.user_id = me).
-- So userCanSeeMatterCard works: it finds the matter, joins to the caller's
-- own membership row, confirms same firm. ✓
--
-- Still no connection change. Cutover is a later, separate step.
-- ============================================================================