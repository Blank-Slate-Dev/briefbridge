-- =============================================================================
-- 0022 — Turn RLS OFF on the billing tables
-- =============================================================================
--
-- Migration 0021 documented these tables as having no RLS, but did not say so
-- to Postgres. Supabase enables RLS by default on new tables, so in practice
-- it was ON with no policies — which denies everything. The Stripe webhook,
-- which runs with no user session and therefore satisfies no user-scoped
-- policy, failed every write with:
--
--   42501: new row violates row-level security policy for table "subscriptions"
--
-- Checkout succeeded, Stripe held a live trialing subscription, and the app
-- still showed "Subscription required" because the local mirror was never
-- written.
--
-- WHY OFF IS CORRECT HERE, rather than adding a policy:
--   - Neither table is reachable from the browser. Both are written only by
--     the webhook and read only by server-side queries.
--   - Every read already constrains on the authenticated user's id, so the
--     protection RLS would provide is present a layer up.
--   - A user-scoped policy cannot express "and also let the webhook write",
--     because the webhook has no user to scope to. The alternatives are a
--     service-role connection or a permissive policy — both amount to the
--     same access with more moving parts.
--
-- If either table ever becomes client-readable, this decision must be
-- revisited: turn RLS back on and give the app role an explicit policy.

alter table subscriptions disable row level security;
alter table trial_fingerprints disable row level security;

-- Grants are unaffected by the RLS setting, but restate them so a fresh
-- database provisioned from migrations alone ends up in the working state.
grant select, insert, update on subscriptions to briefbridge_app;
grant select, insert on trial_fingerprints to briefbridge_app;