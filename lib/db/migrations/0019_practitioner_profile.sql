-- lib/db/migrations/0019_practitioner_profile.sql
--
-- Practitioner profile: how the user practises, so answers can be shaped for
-- their role and practice areas. See lib/practitioner/types.ts for the
-- taxonomy and the "bias, never filter" design rule.
--
-- Both columns are NULLABLE: existing users have no profile set, and the chat
-- route falls back to the balanced default when they are null.

alter table profiles
  add column if not exists practitioner_type text,
  add column if not exists practice_areas text[] not null default '{}';

-- Runtime guard mirroring the PractitionerType union.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_practitioner_type_check'
  ) then
    alter table profiles
      add constraint profiles_practitioner_type_check
      check (
        practitioner_type is null
        or practitioner_type in (
          'solicitor','barrister','in_house','paralegal','student','other'
        )
      );
  end if;
end $$;

-- The app role needs to read and write these.
grant select, insert, update on profiles to briefbridge_app;