// lib/stripe.ts
//
// Server-side Stripe client and billing constants.
//
// SERVER ONLY. STRIPE_SECRET_KEY must never reach the browser — importing this
// from a Client Component will leak it into the bundle. The publishable key
// (NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) is the one that's safe client-side, and
// we don't even need it: Checkout is hosted by Stripe, so we redirect rather
// than mounting card fields ourselves. That also keeps card data entirely off
// our infrastructure, which matters when the customers are lawyers asking
// about your security posture.

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

/** The single subscription price. */
export const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID ?? '';

/** Free trial length, in days, for a card that hasn't had one before. */
export const TRIAL_DAYS = 7;

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