-- lib/db/migrations/0021_stripe_subscriptions.sql
--
-- Stripe billing: one subscription row per user, plus a ledger of card
-- fingerprints that have already consumed a free trial.
--
-- WHY THE FINGERPRINT LEDGER: Stripe gives every card a stable `fingerprint`
-- that is identical across customers and payment methods within an account. If
-- a fingerprint has already had a trial, a new signup with that card starts
-- paying immediately. It does not stop a determined person with a second card,
-- but it stops casual account-recycling, which is the realistic abuse.

-- =============================================================================
-- subscriptions — mirror of Stripe state, one row per user
-- =============================================================================
--
-- Stripe is the source of truth; this table is a local cache kept in sync by
-- the webhook, so that gating a page costs one indexed read rather than an
-- API call.

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,

  stripe_customer_id     text not null,
  stripe_subscription_id text unique,

  -- Mirrors Stripe's subscription.status:
  --   trialing | active | past_due | canceled | incomplete |
  --   incomplete_expired | unpaid | paused
  status text not null,

  price_id text,

  -- End of the paid period. Access is granted up to this instant even after a
  -- cancellation, because the user has paid for it.
  current_period_end timestamptz,

  -- True when the user has cancelled but the period hasn't elapsed.
  cancel_at_period_end boolean not null default false,

  trial_end timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_user_id_idx on subscriptions (user_id);
create index if not exists subscriptions_stripe_customer_idx on subscriptions (stripe_customer_id);
create index if not exists subscriptions_status_idx on subscriptions (status);

-- =============================================================================
-- trial_fingerprints — cards that have already had a free trial
-- =============================================================================

create table if not exists trial_fingerprints (
  id uuid primary key default gen_random_uuid(),
  -- Stripe's card fingerprint. Stable across customers for the same card.
  fingerprint text not null unique,
  -- The first user to consume a trial with this card, kept for support
  -- questions ("why didn't I get a trial?").
  first_user_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists trial_fingerprints_fingerprint_idx
  on trial_fingerprints (fingerprint);

-- =============================================================================
-- Access
-- =============================================================================
--
-- No RLS. Both tables are written only by the webhook and server actions
-- running under the app role, and read only via server-side queries that
-- already constrain on the authenticated user's id. Adding RLS here would mean
-- the webhook (which has no user session) could not write.

grant select, insert, update on subscriptions to briefbridge_app;
grant select, insert on trial_fingerprints to briefbridge_app;