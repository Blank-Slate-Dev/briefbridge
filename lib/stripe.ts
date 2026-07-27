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

/** Monthly subscription price. */
export const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID ?? '';

/** Annual subscription price. */
export const STRIPE_PRICE_ID_YEARLY = process.env.STRIPE_PRICE_ID_YEARLY ?? '';

/**
 * Resolves a billing interval to its Stripe price id.
 *
 * Falls back to monthly if the annual price isn't configured, so a missing
 * env var degrades to "annual option unavailable" rather than a broken
 * checkout. Whether to SHOW the annual option is a separate question — see
 * hasYearlyPrice().
 */
export function priceIdFor(interval: 'month' | 'year'): string {
  if (interval === 'year' && STRIPE_PRICE_ID_YEARLY) {
    return STRIPE_PRICE_ID_YEARLY;
  }
  return STRIPE_PRICE_ID;
}

export function hasYearlyPrice(): boolean {
  return Boolean(STRIPE_PRICE_ID_YEARLY);
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