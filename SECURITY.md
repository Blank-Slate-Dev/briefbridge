# BriefBridge — Security & Data Isolation Notes

_Last updated: during the firm-collaboration build (Slices 1–2 complete)._

## How matter isolation is currently enforced

Access to a matter's contents (files, AI research, conversations, and — once
built — case chat) is enforced at the **application layer** via two helpers in
`lib/db/queries/access.ts`:

- `userCanSeeMatterCard(userId, matterId)` — Ring 1: is the matter in the
  user's firm? (gates the firm-wide card directory)
- `userCanAccessMatter(userId, matterId)` — Ring 2: is the user assigned to the
  matter? (gates everything inside)

Every matter-scoped query takes `userId` as an explicit argument and filters on
it. The matter detail page (`app/(app)/matters/[id]/page.tsx`) gates inside-
access through `userCanAccessMatter`.

This is **real, working enforcement** for the current single-firm-per-user
reality.

## The known gap: RLS is NOT yet engaged

Row-Level Security (RLS) policies in the database are **dormant**, and this is
deliberate-but-temporary. The reason:

- Drizzle connects via `lib/db/index.ts` using `DATABASE_URL`, which uses the
  Supabase **`postgres` role** (via the transaction pooler). That role has
  **`BYPASSRLS`** — so RLS policies are ignored entirely, no matter what is
  written.
- Making RLS actually apply requires either (a) a dedicated non-BYPASSRLS app
  role with per-request user identity established via `SET LOCAL` session
  variables and policies written against them, or (b) routing matter-scoped
  reads through the Supabase client (which carries the authenticated JWT and
  respects RLS) instead of Drizzle. Both are substantial, careful refactors.

### Why deferring is acceptable RIGHT NOW

The threat RLS mitigates is "a developer writes a query that forgets the
ownership/assignment filter, leaking one tenant's data to another." Today:

- There is **one developer** and a **small, centralised set of query functions**
  (all in `lib/db/queries/`).
- There are **zero paying firms** and therefore **no cross-firm data** that
  could leak. Every user is a firm-of-one.

So the gap protects against a threat that does not yet have data to act on.

## REQUIRED before onboarding a second firm (hard gate)

Before any real second firm / second tenant puts data in production, RLS MUST be
engaged. Do this as a dedicated, focused project (not tacked onto a late night):

1. Create a dedicated restricted Postgres role (`NOBYPASSRLS`) for the app, with
   explicit table GRANTs.
2. Establish per-request user identity in the DB session — either `SET LOCAL
   app.user_id = <uid>` at the start of each transaction, or the authenticated
   JWT path.
3. Write + enable RLS policies on: `matters`, `files`, `conversations`,
   `messages`, `matter_assignments`, `case_messages`, `firm_memberships` — keyed
   off firm membership + assignment.
4. **Prove the policies in isolation** (query as the restricted role in the SQL
   editor, confirm allow/deny) BEFORE switching the live Drizzle connection.
5. Switch Drizzle to the restricted role; test reads immediately; keep the
   superuser `DATABASE_URL` handy for rollback.

Until step 5 is done and verified, **do not invite users from a second firm into
production.**

## Other standing security items

- **Rotate the database password.** The pooler password has appeared in
  development chat logs. Reset it (Supabase → Settings → Database), then update
  `.env.local` and Vercel env vars. Outstanding.
- Long-lived auth sessions (400-day cookies) are enabled — fine for the product,
  but note the shared-device consideration for a tool holding privileged files.