-- lib/db/migrations/0020_practitioner_resolution_chain.sql
--
-- Extends the practitioner profile from a single per-user setting into a
-- RESOLUTION CHAIN. Most specific wins:
--
--   1. conversations.practitioner_type     — this thread only (ad-hoc)
--   2. profiles.practitioner_type          — the user's own setting (0019)
--   3. firm_memberships.practitioner_type  — what the firm owner assigned
--   4. null                                — balanced default
--
-- Firm assignment is a FALLBACK, not a lock: an owner can onboard a team with
-- sensible defaults, but each practitioner can still override for themselves,
-- and any single thread can be re-shaped without changing either.

-- ---------- Firm-assigned defaults (set by owner/admin) ----------
alter table firm_memberships
  add column if not exists practitioner_type text,
  add column if not exists practice_areas text[] not null default '{}';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'firm_memberships_practitioner_type_check'
  ) then
    alter table firm_memberships
      add constraint firm_memberships_practitioner_type_check
      check (
        practitioner_type is null
        or practitioner_type in (
          'solicitor','barrister','in_house','paralegal','student','other'
        )
      );
  end if;
end $$;

-- ---------- Per-thread override ----------
alter table conversations
  add column if not exists practitioner_type text,
  add column if not exists practice_areas text[];

-- NOTE: conversations.practice_areas is NULLABLE (no default) on purpose.
-- null  = "inherit from the chain"
-- '{}'  = "explicitly no areas for this thread"
-- These are different states and the resolver relies on the distinction.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'conversations_practitioner_type_check'
  ) then
    alter table conversations
      add constraint conversations_practitioner_type_check
      check (
        practitioner_type is null
        or practitioner_type in (
          'solicitor','barrister','in_house','paralegal','student','other'
        )
      );
  end if;
end $$;

grant select, insert, update on firm_memberships to briefbridge_app;
grant select, insert, update on conversations to briefbridge_app;