BriefBridge — Security & Data Isolation Notes

Last updated: firm-collaboration build (Slices 1–2 complete; Slice 3 RLS
Path A built and ENFORCING LOCALLY — production cutover + credential
rotation outstanding).

================================================================================
SUMMARY (read this first)
================================================================================

Real RLS (Path A, session-variable) is now BUILT and ENFORCING on the LOCAL
connection. Drizzle connects locally as a dedicated NOBYPASSRLS role
(briefbridge_app); every matter-scoped query runs inside a transaction that
sets app.user_id; and session-variable policies key off that. Cross-tenant
isolation has been proven in isolation (see "Isolation proof" below) AND via
live browser testing of every app path.

TWO THINGS REMAIN before this is fully done:

  1. PRODUCTION CUTOVER — the Vercel DATABASE_URL still points at the `postgres`
     superuser (BYPASSRLS). So PRODUCTION IS NOT YET ENFORCING RLS. Local is.
  2. CREDENTIAL ROTATION — the superuser password, the briefbridge_app password,
     and the Anthropic + Voyage API keys have all appeared in development chat
     logs and must be rotated.

Plus one gap to close in Slice 4 (see "Known gap" below): the firm tables have
session-variable SELECT policies only — member-management WRITES will need
INSERT/UPDATE/DELETE policies before they work under the restricted role.

================================================================================
How matter isolation is enforced
================================================================================

Two complementary layers, both now live locally:

LAYER 1 — Application-layer filters (always present)
  Access to a matter's contents (files, AI research, conversations, and — once
  built — case chat) is enforced in the query layer via two helpers in
  lib/db/queries/access.ts:

    userCanSeeMatterCard(userId, matterId) — Ring 1: is the matter in the
      user's firm? (gates the firm-wide card directory)
    userCanAccessMatter(userId, matterId)  — Ring 2: is the user assigned to
      the matter? (gates everything inside)

  Every matter-scoped query takes userId as an explicit argument and filters on
  it. The matter detail page (app/(app)/matters/[id]/page.tsx) gates inside-
  access through userCanAccessMatter and 404s on failure (so a matter can't be
  loaded by guessing its URL, and "not found" is indistinguishable from "not
  yours").

LAYER 2 — Row-Level Security (NOW ENFORCING LOCALLY)
  The database itself now enforces the same ownership, as a backstop under the
  app filters. This is the layer that catches a future query that forgets its
  filter. Built via Path A (session variables) — details below.

================================================================================
RLS status: ENFORCING (local) via Path A — session variables
================================================================================

WHAT WAS BUILT (migrations 0013–0015 + lib/db/with-user.ts):

  0013_restricted_role.sql — created role `briefbridge_app` LOGIN NOBYPASSRLS.
    Granted USAGE on schema public; SELECT on the public reference tables
    (judgments, *_embeddings, legislation*, ingestion_attempts); and
    SELECT/INSERT/UPDATE/DELETE on the user-data tables (profiles, matters,
    conversations, messages, files, file_tags, firms, firm_memberships,
    matter_assignments). NOBYPASSRLS is the whole point — RLS applies to it.

  0014_session_var_policies.sql — added session-variable policies to the six
    user-data tables, reading current_setting('app.user_id', true)::uuid
    instead of auth.uid(). FULL coverage (SELECT/INSERT/UPDATE/DELETE) on
    matters, conversations, files, profiles; the indirect tables (messages via
    conversation ownership, file_tags via file ownership) have the appropriate
    SELECT/INSERT/UPDATE/DELETE subset. These COEXIST with the old auth.uid()
    policies (Postgres ORs permissive policies), so nothing broke during the
    transition. The old auth.uid() policies can be removed in a later cleanup
    step now that the cutover is proven.

  0015_firm_tables_session_var_policies.sql — added session-variable SELECT
    policies to the three firm tables (firms, firm_memberships,
    matter_assignments). Deliberately own-rows-only / non-recursive to avoid
    the RLS infinite-recursion trap that a "see all members of my firm"
    self-referencing policy would create. (See "Known gap" — these are SELECT
    only.)

  lib/db/with-user.ts — the per-request identity helper. RLS policies read
    current_setting('app.user_id'). For that to be set when a query runs, the
    SET and the query must share ONE transaction on ONE pooled connection,
    because the Supabase transaction pooler reclaims the connection (discarding
    SET LOCAL) the moment a transaction ends. withUser(userId, fn) opens a
    transaction, runs `select set_config('app.user_id', <uid>, true)`
    (parameterised — no injection), and hands the callback a `tx` handle. EVERY
    query inside must use `tx`, not the module-level `db` (a `db` call would run
    on a different connection without the variable set).

WHAT WAS CONVERTED (all matter-scoped queries now route through withUser):
  - lib/db/queries/matters.ts, conversations.ts, files.ts, access.ts,
    ai-access.ts — every query wrapped.
  - Caller-file writes that the app/-only grep initially missed, found by a
    full lib/ + app/ sweep and converted: the storage-path patches in
    app/(app)/matters/[id]/files/_actions.ts and app/(app)/chat/_actions.ts,
    and the three anthropic_file_id / anthropic_last_used_at updates in
    lib/anthropic/file-sync.ts.
  - Left as bare `db` ON PURPOSE: public reference-data reads (lib/queries.ts
    over judgments; lib/search/semantic.ts and semantic-legislation.ts over the
    *_embeddings tables; the health-check route). These tables have no RLS and
    briefbridge_app has SELECT on them, so they work unchanged. Ingestion
    scripts (lib/db/ingestion-tracking.ts etc.) run as the service role /
    superuser, NOT through the app connection, so they also stay bare.

THE CORE INCOMPATIBILITY WE SOLVED (kept for the record):
  The original policies were written against auth.uid() — the Supabase JWT
  user. The Drizzle connection has no JWT, so auth.uid() is NULL on it.
  Naively switching Drizzle to a non-bypass role therefore yielded a TOTAL
  LOCKOUT (every auth.uid() policy → NULL → deny), not partial access. Path A
  (session variables, set per-transaction by withUser) is what made RLS work
  for the Drizzle layer without routing everything through the Supabase client.

ISOLATION PROOF (rlscheck.mjs):
  Connecting AS briefbridge_app (the non-bypass role) and setting app.user_id
  per transaction:
    - As the real user: sees own firm_membership (1, role owner), own
      matter_assignments (4), own firms (1).
    - As a different (zero-UUID) user: sees 0 / 0 / 0 across all three.
  Result: PASS — firm-table policies enforce correctly under the restricted
  role. This satisfies the "prove in isolation before cutover" gate for the
  LOCAL cutover. (Re-run before the PRODUCTION cutover too.)

LOCAL CUTOVER (done): .env.local DATABASE_URL points at briefbridge_app. Every
  app path (matters list, matter detail, research chat, file reading, AI access
  panel, file upload) was exercised in the browser and works under RLS.

================================================================================
Known gap — firm tables are SELECT-only under RLS (Slice 4 prerequisite)
================================================================================

0015 gave firms / firm_memberships / matter_assignments session-variable
SELECT policies ONLY. That is sufficient for everything the app does TODAY
(access.ts only ever reads the caller's own rows). Firm-table WRITES today
happen in the Slice 1–2 backfill scripts, which ran as the superuser.

BUT: Slice 4 (member management) will need the app, as briefbridge_app, to
WRITE these tables — inviting a member (INSERT firm_memberships), assigning a
member to a matter (INSERT matter_assignments), changing roles (UPDATE),
removing members (DELETE). There are currently NO session-variable
INSERT/UPDATE/DELETE policies on these tables, so under the restricted role
those writes will DENY (silently — invites/assignments will just fail).

REQUIRED IN SLICE 4: add session-variable INSERT/UPDATE/DELETE policies for
firm_memberships and matter_assignments (and firms as needed), written to AVOID
the recursion trap 0015 already documents — e.g. via a SECURITY DEFINER helper
that resolves "am I an owner/admin of this firm?" without a policy on
firm_memberships recursing into firm_memberships. Do NOT ship member management
to production until these exist and are proven (own test, like rlscheck.mjs).

================================================================================
REQUIRED before onboarding a second firm (HARD GATE)
================================================================================

Two gates that happen to converge — both must be cleared before any real second
firm puts data in production:

  GATE 1 — PRODUCTION CUTOVER. Switch the Vercel DATABASE_URL from the
    `postgres` superuser to briefbridge_app. Until this is done, production
    runs with BYPASSRLS and the database backstop is OFF in production (even
    though it's on locally). Do this as its own focused step:
      a. Re-run rlscheck.mjs against the production DB first (prove isolation).
      b. Keep the superuser DATABASE_URL recorded for instant rollback — it
         bypasses RLS, so it can always undo a bad policy. You cannot be
         permanently locked out as long as you hold that string.
      c. Flip the Vercel env var, redeploy, and exercise every path on the
         deployed site (same checklist as the local cutover).
      d. If any path returns no data / errors, roll back the env var instantly.

  GATE 2 — FIRM-TABLE WRITE POLICIES (only relevant once member management
    exists). See "Known gap" above. A second firm with multiple users implies
    member management, which needs those policies.

================================================================================
The lifeline principle
================================================================================

The superuser DATABASE_URL (pooler, postgres role, BYPASSRLS) is the recovery
path for any RLS mistake. Never lose it; never change a live connection (esp.
production) until policies are proven in isolation against that environment.

================================================================================
Other standing security items
================================================================================

  ROTATE CREDENTIALS — OUTSTANDING, NOW URGENT. The following have appeared in
    development chat logs and must be rotated:
      - The `postgres` superuser DB password.
      - The `briefbridge_app` DB password (in migration 0013 + .env.local).
      - The Anthropic API key (ANTHROPIC_API_KEY) — HIGHEST PRIORITY: anyone
        holding it can spend against the account. Rotate in the Anthropic
        console.
      - The Voyage API key (VOYAGE_API_KEY).
    After rotating the DB passwords, update .env.local AND the Vercel env vars.
    Rotate as a clean, separate pass — not mid-cutover.

  Long-lived auth sessions (400-day cookies) are enabled — fine for the
    product, but note the shared-device consideration for a tool holding
    privileged files.