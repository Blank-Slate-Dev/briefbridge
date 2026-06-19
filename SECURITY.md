BriefBridge — Security & Data Isolation Notes

Last updated: firm-collaboration build (Slices 1–2 complete; Slice 3 partial —
firm-table policies added but RLS still dormant).

How matter isolation is currently enforced

Access to a matter's contents (files, AI research, conversations, and — once
built — case chat) is enforced at the application layer via two helpers in
lib/db/queries/access.ts:


userCanSeeMatterCard(userId, matterId) — Ring 1: is the matter in the
user's firm? (gates the firm-wide card directory)
userCanAccessMatter(userId, matterId) — Ring 2: is the user assigned to the
matter? (gates everything inside)


Every matter-scoped query takes userId as an explicit argument and filters on
it. The matter detail page (app/(app)/matters/[id]/page.tsx) gates inside-
access through userCanAccessMatter.

This is real, working enforcement for the current single-firm-per-user
reality.

RLS status: ENABLED + POLICIED, but DORMANT (not enforcing)

Every app table has rowsecurity = true and a set of policies. The firm tables
(firms, firm_memberships, matter_assignments) got their SELECT policies in
migration 0012_firm_tables_rls.sql (previously they were RLS-enabled with ZERO
policies — a latent deny-all landmine, now fixed).

BUT none of it enforces anything yet, because:


Drizzle connects via lib/db/index.ts using DATABASE_URL, as the Supabase
postgres role, which has BYPASSRLS = true (confirmed via
pg_roles). So every policy is bypassed and inert.


The core incompatibility (the reason Slice 3 is a real project)

This was discovered during the Slice 3 attempt and is the key thing to
understand before doing the real work:

The existing policies are written against auth.uid() — the Supabase JWT
user. The Drizzle connection has no JWT, so auth.uid() is NULL on it.

Therefore, naively switching Drizzle to a non-bypass role does NOT yield partial
access — it yields a total lockout, because:


Every _own policy (matters/files/conversations/messages) evaluates
user_id = auth.uid() → user_id = NULL → false for every row.
The firm-table policies likewise depend on auth.uid() → NULL → deny.


Supabase's RLS model assumes queries arrive through the Supabase client
carrying a user JWT. The Drizzle layer deliberately bypasses that, passing
userId as an explicit function argument instead. These two models do not
compose. Making RLS real requires one of:


(A) Session-variable path: create a dedicated NOBYPASSRLS app role;
rewrite every policy to read current_setting('app.user_id') instead of
auth.uid(); and have every Drizzle query/transaction run
SET LOCAL app.user_id = <uid> first. Fiddly with pooled postgres-js
(transaction pooler + prepare:false), and easy to get wrong per-query.
(B) JWT path: route matter-scoped reads through the Supabase client
(which carries the JWT and satisfies auth.uid()) instead of Drizzle. Large
refactor of the query layer.


Either is a multi-day, focused re-architecture — NOT an incremental step. Do it
as its own project.

Why deferring is acceptable RIGHT NOW

The threat RLS mitigates is "a developer writes a query that forgets the
ownership/assignment filter, leaking one tenant's data to another." Today:


One developer; a small, centralised set of query functions in
lib/db/queries/.
Zero paying firms → no cross-firm data exists to leak. Every user is a
firm-of-one.


So the gap guards a threat that has no data to act on yet.

REQUIRED before onboarding a second firm (HARD GATE)

Before any real second firm puts data in production, RLS MUST actually enforce.
Do this as a dedicated project:


Decide path (A) session-variable or (B) JWT-client (see above).
Create a dedicated restricted Postgres role (NOBYPASSRLS) with explicit
table GRANTs (path A), or wire the Supabase JWT client into matter queries
(path B).
Rewrite/confirm policies on: matters, files, conversations,
messages, matter_assignments, firm_memberships, firms — keyed off the
chosen identity mechanism, covering INSERT/UPDATE/DELETE, not just SELECT.
Prove policies in isolation (query as the restricted role / with a test
JWT in the SQL editor; confirm allow AND deny) BEFORE touching the live
connection.
Switch the live connection LAST. Keep the superuser DATABASE_URL recorded
for instant rollback — it bypasses RLS, so it can always undo bad policies.
You cannot be permanently locked out as long as you hold that string.


Until step 5 is done and verified, do not invite a second firm into
production.

The lifeline principle

The superuser DATABASE_URL (pooler, postgres role, BYPASSRLS) is the
recovery path for any RLS mistake. Never lose it; never change the app
connection until new policies are proven in isolation.

Other standing security items


Rotate the database password. The pooler password has appeared in
development chat logs. Reset it (Supabase → Settings → Database), then update
.env.local and Vercel env vars. OUTSTANDING.
Long-lived auth sessions (400-day cookies) are enabled — fine for the product,
but note the shared-device consideration for a tool holding privileged files.