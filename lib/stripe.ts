// lib/stripe.ts
//
// Server-side Stripe client and billing constants.
//
// SERVER ONLY for the `stripe` instance. STRIPE_SECRET_KEY must never reach
// the browser — importing that binding from a Client Component leaks it into
// the bundle.
//
// The publishable key IS needed client-side: checkout is mounted inside the
// app with Stripe's Embedded Checkout rather than redirecting to a hosted
// page. Card data still never touches our infrastructure — the fields live in
// a Stripe-origin iframe — which is the part that matters when the customers
// are lawyers asking about your security posture.

import Stripe from 'stripe';
import type { PlanFamily, BillingInterval } from '@/lib/billing/copy';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not set. Check your .env.local file.');
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  // Pin the API version. Stripe evolves its API; pinning means an upstream
  // change can't silently alter the shape of what we receive.
  apiVersion: '2026-06-24.dahlia',
  typescript: true,
  appInfo: { name: 'BriefBridge', url: 'https://briefbridge.ai' },
});

/** Individual monthly subscription price. */
export const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID ?? '';

/** Individual annual subscription price. */
export const STRIPE_PRICE_ID_YEARLY = process.env.STRIPE_PRICE_ID_YEARLY ?? '';

/**
 * Firm per-seat prices.
 *
 * BOTH MUST BE CREATED IN STRIPE AS *VOLUME* TIERED PRICES, not graduated and
 * not flat. Volume means the seat count selects ONE rate that then applies to
 * every seat; graduated would charge the first 20 at the base rate and only
 * the excess at the volume rate. Those produce different invoices — a 25-seat
 * firm pays A$1,475/month under volume and A$1,875/month under graduated — and
 * only the volume figure matches what the pricing page says.
 *
 * Tier shape for the monthly price (mirror it for annual with 799/599):
 *   billing_scheme: 'tiered'
 *   tiers_mode:     'volume'
 *   tiers: [
 *     { up_to: 20,      unit_amount: 7900 },
 *     { up_to: 'inf',   unit_amount: 5900 },
 *   ]
 *
 * The `up_to: 20` boundary is FIRM_BASE_RATE_MAX_SEATS in lib/billing/copy.ts.
 * If one moves, move the other — they are the same fact in two systems, and a
 * mismatch would show one price on the page and charge another.
 */
export const STRIPE_PRICE_ID_FIRM = process.env.STRIPE_PRICE_ID_FIRM ?? '';
export const STRIPE_PRICE_ID_FIRM_YEARLY =
  process.env.STRIPE_PRICE_ID_FIRM_YEARLY ?? '';

/**
 * Resolves a plan family and billing interval to its Stripe price id.
 *
 * Returns an empty string when the requested price isn't configured, rather
 * than silently substituting a different one. Charging a firm the individual
 * rate because an env var was missing is a worse failure than a clear error,
 * so the caller checks and refuses.
 *
 * The individual annual price still falls back to monthly, preserving the
 * existing behaviour: a missing STRIPE_PRICE_ID_YEARLY degrades to "annual
 * option unavailable" rather than a broken checkout. Whether to SHOW an option
 * is a separate question — see hasYearlyPrice() / hasFirmPricing().
 */
export function priceIdFor(
  family: PlanFamily,
  interval: BillingInterval,
): string {
  if (family === 'firm') {
    if (interval === 'year') return STRIPE_PRICE_ID_FIRM_YEARLY;
    return STRIPE_PRICE_ID_FIRM;
  }
  if (interval === 'year' && STRIPE_PRICE_ID_YEARLY) {
    return STRIPE_PRICE_ID_YEARLY;
  }
  return STRIPE_PRICE_ID;
}

export function hasYearlyPrice(): boolean {
  return Boolean(STRIPE_PRICE_ID_YEARLY);
}

/**
 * Whether the firm plan can be bought at all.
 *
 * Requires BOTH firm prices. Offering a firm monthly plan with no annual
 * option would silently hide the discount the pricing page advertises, so the
 * whole family is gated on both being present.
 */
export function hasFirmPricing(): boolean {
  return Boolean(STRIPE_PRICE_ID_FIRM && STRIPE_PRICE_ID_FIRM_YEARLY);
}

/** Every configured price id, for naming the plan on an active subscription. */
export function priceIdMap(): Record<string, { family: PlanFamily; interval: BillingInterval }> {
  const map: Record<string, { family: PlanFamily; interval: BillingInterval }> = {};
  if (STRIPE_PRICE_ID) map[STRIPE_PRICE_ID] = { family: 'individual', interval: 'month' };
  if (STRIPE_PRICE_ID_YEARLY) map[STRIPE_PRICE_ID_YEARLY] = { family: 'individual', interval: 'year' };
  if (STRIPE_PRICE_ID_FIRM) map[STRIPE_PRICE_ID_FIRM] = { family: 'firm', interval: 'month' };
  if (STRIPE_PRICE_ID_FIRM_YEARLY) map[STRIPE_PRICE_ID_FIRM_YEARLY] = { family: 'firm', interval: 'year' };
  return map;
}

/** Free trial length, in days, for a card that hasn't had one before. */
export const TRIAL_DAYS = 7;

/**
 * Publishable key, safe to ship to the browser.
 *
 * Read via the full literal `process.env.NEXT_PUBLIC_...` rather than a
 * computed key: Next inlines these at build time by static text match, so a
 * dynamic lookup would come back undefined in the browser bundle.
 */
export const STRIPE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

/** Absolute base URL for Stripe redirect targets. */
export function appUrl(path = ''): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ??
    'https://briefbridge.ai';
  return `${base}${path}`;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_ID);
}
