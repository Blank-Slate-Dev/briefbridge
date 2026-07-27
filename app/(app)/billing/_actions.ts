// app/(app)/billing/_actions.ts
//
// Server actions for billing: start a subscription, cancel, resume, and open
// the customer portal.
//
// 'use server' rule observed throughout this codebase: async function exports
// ONLY. No type re-exports — Turbopack keeps dangling references to them and
// they fail at runtime. Result shapes are inlined.
//
// CANCEL/RESUME are done here rather than in Stripe's hosted portal because
// the portal cannot be embedded (it refuses to be iframed), and sending
// someone off-site to cancel is a poor experience for the one action they are
// most likely to want. Card updates and invoice history still live in the
// portal, which is why createPortalSessionAction remains.

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { stripe, STRIPE_PRICE_ID, TRIAL_DAYS, appUrl } from '@/lib/stripe';
import {
  getSubscription,
  upsertSubscription,
} from '@/lib/db/queries/subscription';
import type { SubscriptionStatus } from '@/lib/db/schema';

type ActionResult = { ok: true; url: string } | { ok: false; error: string };
type MutateResult = { ok: true } | { ok: false; error: string };

/**
 * Creates a Stripe Checkout session and returns its URL.
 *
 * TRIAL HANDLING — why the trial is decided here rather than on the price:
 *   Setting a trial on the price in the dashboard would give one to everybody,
 *   every time, including someone who deleted their account and signed up
 *   again. Instead the trial is requested here, and the WEBHOOK does the
 *   enforcement: when a subscription is created it reads the card's
 *   fingerprint and, if that card has had a trial before, ends the trial
 *   immediately so billing starts now.
 *
 *   It has to work that way round because the card doesn't exist yet at this
 *   point — the user hasn't entered it. We can't check a fingerprint we don't
 *   have, so we offer the trial optimistically and revoke it a moment later if
 *   the card turns out to be a repeat. The user sees "7 days free" on the
 *   Stripe page either way; a repeat card simply gets charged today.
 */
export async function createCheckoutSessionAction(): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  if (!STRIPE_PRICE_ID) {
    return { ok: false, error: 'Billing is not configured.' };
  }

  try {
    // Reuse the Stripe customer if this user has one, so their billing history
    // stays on a single record across resubscribes.
    const existing = await getSubscription(user.id);
    let customerId = existing?.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        // The user id travels on the customer so the webhook can map Stripe
        // events back to our user without a lookup table.
        metadata: { userId: user.id },
      });
      customerId = customer.id;
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],

      subscription_data: {
        trial_period_days: TRIAL_DAYS,
        metadata: { userId: user.id },
      },

      // Card required up front even during the trial: it filters out
      // tyre-kickers and converts automatically at day 7.
      payment_method_collection: 'always',

      success_url: appUrl('/matters?checkout=success'),
      cancel_url: appUrl('/billing?checkout=cancelled'),

      allow_promotion_codes: true,
      client_reference_id: user.id,
    });

    if (!session.url) {
      return { ok: false, error: 'Stripe did not return a checkout URL.' };
    }
    return { ok: true, url: session.url };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[billing] createCheckoutSession failed:', err);
    return {
      ok: false,
      error: 'Could not start checkout. Please try again.',
    };
  }
}

/**
 * Cancels at the end of the paid period — NOT immediately.
 *
 * Immediate cancellation would take away access the user has already paid
 * for. `cancel_at_period_end` keeps them entitled until the period elapses,
 * which is also what getAccessState already understands.
 *
 * The local mirror is written here as well as by the webhook. That is
 * deliberate duplication: the webhook is authoritative, but it can take a
 * second or two to arrive, and the UI needs to reflect the change on the very
 * next render. The webhook's later upsert simply agrees.
 */
export async function cancelSubscriptionAction(): Promise<MutateResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const sub = await getSubscription(user.id);
  if (!sub?.stripeSubscriptionId) {
    return { ok: false, error: 'No active subscription found.' };
  }
  if (sub.cancelAtPeriodEnd) {
    return { ok: true };
  }

  try {
    const updated = await stripe.subscriptions.update(
      sub.stripeSubscriptionId,
      { cancel_at_period_end: true },
    );

    await upsertSubscription({
      userId: user.id,
      stripeCustomerId: sub.stripeCustomerId,
      stripeSubscriptionId: updated.id,
      status: updated.status as SubscriptionStatus,
      priceId: updated.items.data[0]?.price?.id ?? sub.priceId,
      currentPeriodEnd: toDate(updated.items.data[0]?.current_period_end),
      cancelAtPeriodEnd: updated.cancel_at_period_end,
      trialEnd: toDate(updated.trial_end),
    });

    revalidatePath('/settings');
    revalidatePath('/billing');
    return { ok: true };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[billing] cancelSubscription failed:', err);
    return { ok: false, error: 'Could not cancel. Please try again.' };
  }
}

/** Undoes a pending cancellation, while the period is still running. */
export async function resumeSubscriptionAction(): Promise<MutateResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const sub = await getSubscription(user.id);
  if (!sub?.stripeSubscriptionId) {
    return { ok: false, error: 'No subscription found.' };
  }

  try {
    const updated = await stripe.subscriptions.update(
      sub.stripeSubscriptionId,
      { cancel_at_period_end: false },
    );

    await upsertSubscription({
      userId: user.id,
      stripeCustomerId: sub.stripeCustomerId,
      stripeSubscriptionId: updated.id,
      status: updated.status as SubscriptionStatus,
      priceId: updated.items.data[0]?.price?.id ?? sub.priceId,
      currentPeriodEnd: toDate(updated.items.data[0]?.current_period_end),
      cancelAtPeriodEnd: updated.cancel_at_period_end,
      trialEnd: toDate(updated.trial_end),
    });

    revalidatePath('/settings');
    revalidatePath('/billing');
    return { ok: true };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[billing] resumeSubscription failed:', err);
    return { ok: false, error: 'Could not resume. Please try again.' };
  }
}

/**
 * Opens the Stripe customer portal, where the user can update their card or
 * see invoices. Cancelling no longer needs it (see cancelSubscriptionAction),
 * but card and invoice handling would mean touching card data, so it stays.
 */
export async function createPortalSessionAction(): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  const sub = await getSubscription(user.id);
  if (!sub?.stripeCustomerId) {
    return { ok: false, error: 'No billing account found.' };
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: appUrl('/billing'),
    });
    return { ok: true, url: session.url };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[billing] createPortalSession failed:', err);
    return { ok: false, error: 'Could not open the billing portal.' };
  }
}

/** Convenience wrapper: start checkout and redirect straight there. */
export async function startCheckoutAction(): Promise<void> {
  const result = await createCheckoutSessionAction();
  if (result.ok) {
    redirect(result.url);
  }
  redirect('/billing?error=checkout');
}

function toDate(unixSeconds: number | null | undefined): Date | null {
  return typeof unixSeconds === 'number' ? new Date(unixSeconds * 1000) : null;
}