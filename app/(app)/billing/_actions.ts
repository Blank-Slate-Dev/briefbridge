// app/(app)/billing/_actions.ts
//
// Server actions for billing: start a subscription (embedded), cancel,
// resume, and open the customer portal.
//
// 'use server' rule observed throughout this codebase: async function exports
// ONLY. No type re-exports — Turbopack keeps dangling references to them and
// they fail at runtime. Result shapes are inlined.
//
// NO REDIRECTS is the goal for this surface. Subscribing uses Stripe's
// EMBEDDED Checkout, which mounts in an iframe on our own page and returns a
// client secret rather than a URL. Cancel and resume are plain API calls.
// The hosted portal remains only for card updates and invoice history, which
// are the two things Stripe won't let us embed.

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

type UrlResult = { ok: true; url: string } | { ok: false; error: string };
type SecretResult =
  | { ok: true; clientSecret: string }
  | { ok: false; error: string };
type MutateResult = { ok: true } | { ok: false; error: string };
type StatusResult =
  | { ok: true; status: string; paymentStatus: string }
  | { ok: false; error: string };

/**
 * Finds or creates this user's Stripe customer.
 *
 * Reusing the customer keeps a person's whole billing history on one record
 * across cancel-and-resubscribe cycles, and it is what lets the trial
 * fingerprint check see their previous cards.
 */
async function resolveCustomerId(
  userId: string,
  email: string | null,
): Promise<string> {
  const existing = await getSubscription(userId);
  if (existing?.stripeCustomerId) return existing.stripeCustomerId;

  const customer = await stripe.customers.create({
    email: email ?? undefined,
    // The user id travels on the customer so the webhook can map Stripe
    // events back to our user without a lookup table.
    metadata: { userId },
  });
  return customer.id;
}

/**
 * Creates an EMBEDDED Checkout session and returns its client secret.
 *
 * The secret is handed to <EmbeddedCheckoutProvider> on the client, which
 * mounts Stripe's payment form in an iframe on our page. Nothing navigates.
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
 *   the card turns out to be a repeat.
 */
export async function createEmbeddedCheckoutAction(): Promise<SecretResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  if (!STRIPE_PRICE_ID) {
    return { ok: false, error: 'Billing is not configured.' };
  }

  try {
    const customerId = await resolveCustomerId(user.id, user.email ?? null);

    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded_page',
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

      // Embedded sessions don't take a success_url. On completion Stripe
      // calls onComplete in the browser and the component polls
      // getCheckoutSessionStatusAction — so the user stays on our page.
      redirect_on_completion: 'never',

      allow_promotion_codes: true,
      client_reference_id: user.id,
    });

    if (!session.client_secret) {
      return { ok: false, error: 'Stripe did not return a client secret.' };
    }
    return { ok: true, clientSecret: session.client_secret };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[billing] createEmbeddedCheckout failed:', err);
    return { ok: false, error: 'Could not start checkout. Please try again.' };
  }
}

/**
 * Reads back a completed embedded session.
 *
 * The client calls this after Stripe signals completion, so it can show a
 * confirmed state. It is NOT how entitlement is granted — the webhook does
 * that, and remains the only trustworthy channel. This is presentation.
 */
export async function getCheckoutSessionStatusAction(
  sessionId: string,
): Promise<StatusResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not authenticated.' };

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    // Don't let one user read another's session by guessing an id.
    if (session.client_reference_id !== user.id) {
      return { ok: false, error: 'Session not found.' };
    }

    return {
      ok: true,
      status: session.status ?? 'unknown',
      paymentStatus: session.payment_status ?? 'unknown',
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[billing] getCheckoutSessionStatus failed:', err);
    return { ok: false, error: 'Could not read the checkout session.' };
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
 * Opens the Stripe customer portal — the ONE remaining redirect.
 *
 * Kept for card updates and invoice history only. Both would otherwise mean
 * handling card data ourselves or rebuilding an invoice list, and Stripe
 * refuses to let the portal be iframed, so there is no embedded equivalent.
 */
export async function createPortalSessionAction(): Promise<UrlResult> {
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
      return_url: appUrl('/settings'),
    });
    return { ok: true, url: session.url };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[billing] createPortalSession failed:', err);
    return { ok: false, error: 'Could not open the billing portal.' };
  }
}

/**
 * Hosted-checkout fallback, kept for any entry point that still wants a
 * redirect (and as an escape hatch if the embedded form ever misbehaves).
 */
export async function startCheckoutAction(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/billing');

  if (!STRIPE_PRICE_ID) redirect('/billing?error=checkout');

  try {
    const customerId = await resolveCustomerId(user.id, user.email ?? null);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      subscription_data: {
        trial_period_days: TRIAL_DAYS,
        metadata: { userId: user.id },
      },
      payment_method_collection: 'always',
      success_url: appUrl('/matters?checkout=success'),
      cancel_url: appUrl('/billing?checkout=cancelled'),
      allow_promotion_codes: true,
      client_reference_id: user.id,
    });
    if (session.url) redirect(session.url);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[billing] startCheckout failed:', err);
  }
  redirect('/billing?error=checkout');
}

function toDate(unixSeconds: number | null | undefined): Date | null {
  return typeof unixSeconds === 'number' ? new Date(unixSeconds * 1000) : null;
}