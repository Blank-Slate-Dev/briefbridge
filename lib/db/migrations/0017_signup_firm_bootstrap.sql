-- 0017_signup_firm_bootstrap.sql  (v2 — simplified)
-- ============================================================================
-- SLICE 4: quiet firm-of-one + owner membership on every NEW signup.
--
-- v1 added an invite-lookup block that queried firm_invitations (which does
-- not exist until migration 0018). That block threw, the EXCEPTION handler
-- caught it, and the ENTIRE firm bootstrap was skipped — so new signups got a
-- profile but no firm. Confirmed by isolating the inserts (they work fine).
--
-- v2 FIX: remove the invite lookup entirely. This trigger now ALWAYS creates a
-- firm-of-one. The "skip bootstrap for invited users" logic is moved to
-- migration 0018, where firm_invitations actually exists — that's the correct
-- home for it. Doing it here, before the table existed, was the bug.
--
-- Solo users are a firm-of-one under the hood (keeps the RLS/access model
-- intact). "Upgrade to a firm" later just bumps seats 1 -> 5 and unlocks the
-- invite UI. When 0018 lands, an invited user's bootstrap firm is reconciled
-- at accept time (they leave their solo firm and join the inviting firm).
--
-- SAFETY (runs on EVERY signup): all firm logic is wrapped so any failure
-- logs a warning and still creates the profile + RETURN NEW. A broken trigger
-- here would rollback the auth.users insert and block ALL signups; the wrapper
-- prevents that.
--
-- IDEMPOTENT: CREATE OR REPLACE.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_firm_id  uuid;
  derived_name text;
BEGIN
  -- 1. Existing behaviour, unchanged: create the bare profile row.
  INSERT INTO public.profiles (id) VALUES (NEW.id);

  -- 2. Always create a quiet firm-of-one (1 seat) + owner membership.
  --    Wrapped so any failure cannot block signup.
  BEGIN
    derived_name := COALESCE(NULLIF(split_part(NEW.email, '@', 1), ''), 'My');
    derived_name := initcap(derived_name) || '''s Firm';

    INSERT INTO public.firms (name, plan, seats)
    VALUES (derived_name, 'trial', 1)
    RETURNING id INTO new_firm_id;

    INSERT INTO public.firm_memberships (firm_id, user_id, role)
    VALUES (new_firm_id, NEW.id, 'owner');

  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_user: firm bootstrap failed for user %: %',
      NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

-- Trigger on_auth_user_created already exists and points at this function;
-- CREATE OR REPLACE keeps it wired. No trigger change needed.