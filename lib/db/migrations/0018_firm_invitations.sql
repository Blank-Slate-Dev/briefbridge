-- 0018_firm_invitations.sql
-- ============================================================================
-- SLICE 4: firm_invitations table + RLS policies.
--
-- Pending invites for the firm member-invite flow. Two paths both use this:
--   - NEW email (no account): invite link -> sign up -> set password+name ->
--     joins the inviting firm (instead of getting an auto firm-of-one).
--   - EXISTING email (has account): in-app pending invite they accept.
--
-- Role is chosen by the inviting owner/admin: admin | lawyer | paralegal.
-- NOT 'owner' (one owner per firm = the creator). Enforced by CHECK.
--
-- Expiry: 14 days from creation (default).
--
-- RLS: gated on current_firm_role() (proven in migration 0016). Only
-- owner/admin of the INVITING firm may create / view / revoke invites. Plus a
-- self-lookup SELECT so an invited user can find their own pending invite by
-- email during accept.
--
-- Run each block separately in the SQL editor. After running, DUMP the table
-- and policies to confirm they actually applied (lesson from 0017).
-- ============================================================================


-- ----------------------------------------------------------------------------
-- BLOCK 1 — the table.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.firm_invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firm_id     uuid NOT NULL REFERENCES public.firms(id) ON DELETE CASCADE,
  email       text NOT NULL,
  role        text NOT NULL CHECK (role IN ('admin', 'lawyer', 'paralegal')),
  token       text NOT NULL UNIQUE,
  status      text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  invited_by  uuid,                          -- the owner/admin who sent it
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Fast lookup of a firm's invites.
CREATE INDEX IF NOT EXISTS firm_invitations_firm_id_idx
  ON public.firm_invitations (firm_id);

-- Fast lookup by email (accept flow: "do I have a pending invite?").
CREATE INDEX IF NOT EXISTS firm_invitations_email_idx
  ON public.firm_invitations (lower(email));

-- Fast lookup by token (the invite link).
CREATE INDEX IF NOT EXISTS firm_invitations_token_idx
  ON public.firm_invitations (token);

-- At most ONE pending invite per (firm, email). Revoked/expired don't block
-- re-inviting. Partial unique index = the guard.
CREATE UNIQUE INDEX IF NOT EXISTS firm_invitations_one_pending_per_email
  ON public.firm_invitations (firm_id, lower(email))
  WHERE status = 'pending';


-- ----------------------------------------------------------------------------
-- BLOCK 2 — grants + enable RLS.
-- The app connects as briefbridge_app, so it needs table privileges; RLS then
-- decides which rows. Both are required.
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.firm_invitations TO briefbridge_app;

ALTER TABLE public.firm_invitations ENABLE ROW LEVEL SECURITY;


-- ----------------------------------------------------------------------------
-- BLOCK 3 — RLS policies (session-variable, like the rest of the app).
--
-- All gated on current_firm_role(firm_id) via the SECURITY DEFINER helper from
-- 0016 (non-recursive). Owner/admin of the inviting firm can do everything;
-- an invited user can SELECT their own pending invite by email.
-- ----------------------------------------------------------------------------

-- SELECT: owner/admin of the firm can see the firm's invites...
DROP POLICY IF EXISTS firm_invitations_select_admin ON public.firm_invitations;
CREATE POLICY firm_invitations_select_admin ON public.firm_invitations
  FOR SELECT
  USING (
    public.current_firm_role(firm_id) IN ('owner', 'admin')
  );

-- SELECT: ...OR the invited person can see their OWN pending invite, matched by
-- the email on their auth user. (current_setting('app.user_id') -> their id ->
-- their email via a definer lookup would be ideal, but we match on the email
-- stored at invite time against the caller's email through a helper.)
-- For now we expose an invited user's own invite via a SECURITY DEFINER helper
-- that returns the caller's email, so the policy can compare.
CREATE OR REPLACE FUNCTION public.current_user_email()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email FROM auth.users
  WHERE id = current_setting('app.user_id', true)::uuid
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.current_user_email() TO briefbridge_app;

DROP POLICY IF EXISTS firm_invitations_select_own ON public.firm_invitations;
CREATE POLICY firm_invitations_select_own ON public.firm_invitations
  FOR SELECT
  USING (
    lower(email) = lower(public.current_user_email())
  );

-- INSERT: only owner/admin of the target firm may create an invite.
DROP POLICY IF EXISTS firm_invitations_insert_admin ON public.firm_invitations;
CREATE POLICY firm_invitations_insert_admin ON public.firm_invitations
  FOR INSERT
  WITH CHECK (
    public.current_firm_role(firm_id) IN ('owner', 'admin')
  );

-- UPDATE: owner/admin can update (revoke, mark accepted) the firm's invites.
-- ALSO allow the invited user to mark their own invite accepted: covered by the
-- own-email arm so the accept flow can flip status to 'accepted'.
DROP POLICY IF EXISTS firm_invitations_update_admin ON public.firm_invitations;
CREATE POLICY firm_invitations_update_admin ON public.firm_invitations
  FOR UPDATE
  USING (
    public.current_firm_role(firm_id) IN ('owner', 'admin')
    OR lower(email) = lower(public.current_user_email())
  )
  WITH CHECK (
    public.current_firm_role(firm_id) IN ('owner', 'admin')
    OR lower(email) = lower(public.current_user_email())
  );

-- DELETE: only owner/admin of the firm.
DROP POLICY IF EXISTS firm_invitations_delete_admin ON public.firm_invitations;
CREATE POLICY firm_invitations_delete_admin ON public.firm_invitations
  FOR DELETE
  USING (
    public.current_firm_role(firm_id) IN ('owner', 'admin')
  );


-- ============================================================================
-- NOTE: the "skip firm-of-one bootstrap for invited users" logic now belongs
-- in the signup trigger, which can finally reference this table. We will add
-- that back to handle_new_user() as a SEPARATE, carefully-tested step AFTER
-- confirming this table exists and works — NOT bundled here, because changing
-- the signup trigger is the highest-risk edit and must be done and verified on
-- its own. (Lesson from 0017.)
-- ============================================================================