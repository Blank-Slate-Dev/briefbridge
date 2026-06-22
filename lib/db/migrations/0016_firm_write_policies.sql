-- 0016_firm_write_policies.sql
-- ============================================================================
-- SLICE 4 PREREQUISITE: write policies for the firm tables.
--
-- Migration 0015 gave firms / firm_memberships / matter_assignments
-- session-variable SELECT policies ONLY. Under the briefbridge_app role
-- (NOBYPASSRLS, now live in BOTH local and production), any INSERT/UPDATE/
-- DELETE on these tables DENIES. Member management (invite, assign, change
-- role, remove) needs those writes. This migration adds them.
--
-- THE RECURSION PROBLEM (and the fix):
--   A write policy on firm_memberships needs to ask "is the calling user an
--   owner/admin of this firm?" — which means reading firm_memberships. A
--   policy that queries its own table re-triggers the policy → infinite
--   recursion under a non-bypass role. The fix is a SECURITY DEFINER function:
--   it runs as the function OWNER (a superuser/table-owner that bypasses RLS
--   for the duration of the function body), so the lookup inside it does NOT
--   re-enter the policy. The policy calls the function; the function reads the
--   table cleanly; no recursion.
--
-- ADDITIVE + DORMANT-SAFE: these only ADD write permission that doesn't exist
-- today. On the old superuser connection (BYPASSRLS) they're irrelevant; on
-- briefbridge_app they light up. Nothing currently working breaks.
--
-- ROLE RULES IMPLEMENTED (per spec, option (ii)):
--   firm_memberships:
--     INSERT  — only owner/admin of the target firm may add a member
--     UPDATE  — only owner/admin (e.g. change a member's role)
--     DELETE  — only owner/admin (remove a member)
--   matter_assignments:
--     INSERT  — owner/admin of the matter's firm, OR a lawyer who is
--               themselves assigned to that matter
--     DELETE  — owner/admin of the matter's firm, OR a lawyer assigned to it
--     (no UPDATE — assignments are insert/delete only; the table has no
--      mutable columns worth updating)
--
-- Run each block separately in the SQL editor (select-all per block).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- BLOCK 1 — the recursion-safe role-check function.
--
-- Returns the calling user's FirmRole in the given firm, or NULL if they have
-- no membership there. SECURITY DEFINER so the firm_memberships read inside
-- does not re-enter RLS. STABLE because it doesn't modify data and returns the
-- same result within a statement. search_path pinned to public for safety
-- (SECURITY DEFINER functions must pin search_path to avoid hijacking).
--
-- It reads app.user_id the same way the policies do — so it answers "what is
-- the role of the user this transaction is acting as, in firm X?".
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_firm_role(target_firm_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM firm_memberships
  WHERE firm_id = target_firm_id
    AND user_id = current_setting('app.user_id', true)::uuid
  LIMIT 1;
$$;

-- The function is owned by the role that runs this migration (the table owner /
-- superuser), which is what gives it bypass inside its body. We must let the
-- app role EXECUTE it.
GRANT EXECUTE ON FUNCTION public.current_firm_role(uuid) TO briefbridge_app;


-- ----------------------------------------------------------------------------
-- BLOCK 2 — firm_memberships write policies.
--
-- A member may be added/changed/removed in firm X only by an owner/admin of
-- firm X. The check uses current_firm_role(firm_id) — non-recursive via the
-- SECURITY DEFINER function above.
--
-- NOTE on the very first member: when a firm is first created, the creating
-- user has NO membership yet, so current_firm_role() returns NULL and this
-- INSERT policy would block them from adding themselves as owner. That
-- bootstrap insert (firm + first owner membership) is therefore done in the
-- firm-creation server action running as the SERVICE ROLE (superuser), not as
-- briefbridge_app — the same way Slice 1/2 backfill ran. Ordinary
-- "invite a teammate" inserts go through briefbridge_app and this policy.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS firm_memberships_insert_sessvar ON firm_memberships;
CREATE POLICY firm_memberships_insert_sessvar ON firm_memberships
  FOR INSERT
  WITH CHECK (
    public.current_firm_role(firm_id) IN ('owner', 'admin')
  );

DROP POLICY IF EXISTS firm_memberships_update_sessvar ON firm_memberships;
CREATE POLICY firm_memberships_update_sessvar ON firm_memberships
  FOR UPDATE
  USING (
    public.current_firm_role(firm_id) IN ('owner', 'admin')
  )
  WITH CHECK (
    public.current_firm_role(firm_id) IN ('owner', 'admin')
  );

DROP POLICY IF EXISTS firm_memberships_delete_sessvar ON firm_memberships;
CREATE POLICY firm_memberships_delete_sessvar ON firm_memberships
  FOR DELETE
  USING (
    public.current_firm_role(firm_id) IN ('owner', 'admin')
  );


-- ----------------------------------------------------------------------------
-- BLOCK 3 — matter_assignments write policies.
--
-- INSERT/DELETE allowed if the caller is owner/admin of the matter's firm, OR
-- a lawyer who is themselves assigned to that matter. We resolve the matter's
-- firm via the matters table (matters.firm_id), then check the caller's role
-- in that firm. The "lawyer assigned to this matter" arm checks for the
-- caller's own row in matter_assignments — that read is governed by the
-- matter_assignments SELECT policy (own-rows), which is fine and non-recursive
-- because it only ever matches the caller's own assignment row.
--
-- We read matters.firm_id inside a scalar subquery. The matters SELECT policy
-- (0014, own-rows by user_id) might not expose a firm-mate's matter to the
-- caller — so to resolve firm_id reliably regardless of who owns the matter
-- row, we use a SECURITY DEFINER helper for the firm lookup too.
-- ----------------------------------------------------------------------------

-- Helper: the firm a matter belongs to, read without RLS interference.
CREATE OR REPLACE FUNCTION public.matter_firm_id(target_matter_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT firm_id
  FROM matters
  WHERE id = target_matter_id
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.matter_firm_id(uuid) TO briefbridge_app;

-- Helper: is the calling user assigned to this matter? SECURITY DEFINER so it
-- reads matter_assignments without depending on policy visibility quirks.
CREATE OR REPLACE FUNCTION public.is_assigned_to_matter(target_matter_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM matter_assignments
    WHERE matter_id = target_matter_id
      AND user_id = current_setting('app.user_id', true)::uuid
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_assigned_to_matter(uuid) TO briefbridge_app;

DROP POLICY IF EXISTS matter_assignments_insert_sessvar ON matter_assignments;
CREATE POLICY matter_assignments_insert_sessvar ON matter_assignments
  FOR INSERT
  WITH CHECK (
    public.current_firm_role(public.matter_firm_id(matter_id)) IN ('owner', 'admin')
    OR (
      public.current_firm_role(public.matter_firm_id(matter_id)) = 'lawyer'
      AND public.is_assigned_to_matter(matter_id)
    )
  );

DROP POLICY IF EXISTS matter_assignments_delete_sessvar ON matter_assignments;
CREATE POLICY matter_assignments_delete_sessvar ON matter_assignments
  FOR DELETE
  USING (
    public.current_firm_role(public.matter_firm_id(matter_id)) IN ('owner', 'admin')
    OR (
      public.current_firm_role(public.matter_firm_id(matter_id)) = 'lawyer'
      AND public.is_assigned_to_matter(matter_id)
    )
  );


-- ============================================================================
-- NOTE: no policy on `firms` for writes yet. Firm rows are created in the
-- firm-creation action (service role) and rarely updated. If/when the app lets
-- an owner rename their firm or change seats via briefbridge_app, add an
-- UPDATE policy here keyed off current_firm_role(id) = 'owner'.
--
-- Still no connection change in this migration. After it runs, member-
-- management WRITES become possible under briefbridge_app, gated by role.
-- PROVE IN ISOLATION (a test like rlscheck.mjs: confirm an owner CAN insert a
-- membership, a lawyer CANNOT, a stranger CANNOT) before building the UI on it.
-- ============================================================================