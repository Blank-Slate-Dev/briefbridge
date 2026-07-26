// app/api/stripe/webhook/route.ts
//
// Stripe webhook — the only place subscription state is written.
//
// WHY A WEBHOOK AND NOT THE SUCCESS REDIRECT: a user can close the tab before
// the redirect fires, and the redirect can be forged. Stripe's signed webhook
// is the trustworthy channel, so the success page is cosmetic and this is
// authoritative.
//
// TRIAL ENFORCEMENT lives here (see enforceTrialPolicy below) because the card
// fingerprint only exists once the user has entered a card — which is after
// checkout, not before.
//
// SETUP: create the endpoint at
//   https://dashboard.stripe.com/webhooks
//   URL:    https://briefbridge.ai/api/stripe/webhook
//   Events: checkout.session.completed, customer.subscription.created,
//           customer.subscription.updated, customer.subscription.deleted,
//           invoice.payment_failed
// then put its signing secret in STRIPE_WEBHOOK_SECRET.

import type Stripe from 'stripe';
import { stripe } from '@/lib/stripe';
import {
  upsertSubscription,
  hasUsedTrial,
  recordTrialFingerprint,
} from '@/lib/db/queries/subscription';
import type { SubscriptionStatus } from '@/lib/db/schema';

export const runtime = 'nodejs';
// The signature is computed over the RAW body, so this route must never be
// cached or have its body transformed.
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    // eslint-disable-next-line no-console
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set');
    return new Response('Webhook not configured', { status: 500 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return new Response('Missing stripe-signature header', { status: 400 });
  }

  // Raw text, not request.json() — parsing would break the signature check.
  const body = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      '[stripe-webhook] signature verification failed:',
      err instanceof Error ? err.message : String(err),
    );
    return new Response('Invalid signature', { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(
            typeof session.subscription === 'string'
              ? session.subscription
              : session.subscription.id,
          );
          await enforceTrialPolicy(sub);
          await syncSubscription(sub);
        }
        break;
      }

      case 'customer.subscription.created': {
        const sub = event.data.object as Stripe.Subscription;
        await enforceTrialPolicy(sub);
        await syncSubscription(sub);
        break;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await syncSubscription(event.data.object as Stripe.Subscription);
        break;
      }

      case 'invoice.payment_failed': {
        // Stripe moves the subscription to past_due itself and emits an
        // update event; nothing to do here beyond noting it.
        const invoice = event.data.object as Stripe.Invoice;
        // eslint-disable-next-line no-console
        console.warn(
          '[stripe-webhook] payment failed for customer',
          invoice.customer,
        );
        break;
      }

      default:
        // Unhandled event types are fine — acknowledge so Stripe stops
        // retrying them.
        break;
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[stripe-webhook] handler failed:', err);
    // 500 makes Stripe retry with backoff, which is what we want for a
    // transient database problem.
    return new Response('Handler error', { status: 500 });
  }
}

// =============================================================================
// Trial enforcement
// =============================================================================

/**
 * Stops the same card being used for repeated free trials.
 *
 * Checkout optimistically grants everyone a trial, because at that moment the
 * user hasn't entered a card and there is no fingerprint to check. Here — a
 * moment later, with the payment method attached — we look the card up. If it
 * has had a trial before, we end the trial immediately so billing starts now.
 * Otherwise we record the fingerprint so the next attempt is caught.
 *
 * Stripe fingerprints are stable for the same card across customers within an
 * account, which is what makes this work across deleted-and-recreated
 * accounts. It does not defeat someone with a second card; it defeats casual
 * recycling, which is the realistic abuse.
 *
 * Never throws — a failure here must not break the subscription sync.
 */
async function enforceTrialPolicy(sub: Stripe.Subscription): Promise<void> {
  try {
    if (sub.status !== 'trialing') return;

    const userId = sub.metadata?.userId;
    if (!userId) return;

    const fingerprint = await cardFingerprint(sub);
    if (!fingerprint) return;

    if (await hasUsedTrial(fingerprint)) {
      // End the trial now: Stripe bills immediately and the status moves to
      // active (or past_due if the charge fails).
      await stripe.subscriptions.update(sub.id, { trial_end: 'now' });
      // eslint-disable-next-line no-console
      console.warn(
        '[stripe-webhook] trial revoked — card already used a trial',
        { userId },
      );
      return;
    }

    await recordTrialFingerprint(fingerprint, userId);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[stripe-webhook] enforceTrialPolicy failed:', err);
  }
}

/** Fingerprint of the card backing a subscription, if it is a card. */
async function cardFingerprint(
  sub: Stripe.Subscription,
): Promise<string | null> {
  const pmId =
    typeof sub.default_payment_method === 'string'
      ? sub.default_payment_method
      : (sub.default_payment_method?.id ?? null);

  // Fall back to the customer's default payment method — during a trial the
  // subscription may not have one set yet.
  let paymentMethodId = pmId;
  if (!paymentMethodId) {
    const customerId =
      typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    const customer = await stripe.customers.retrieve(customerId);
    if (!('deleted' in customer)) {
      const def = customer.invoice_settings?.default_payment_method;
      paymentMethodId = typeof def === 'string' ? def : (def?.id ?? null);
    }
  }
  if (!paymentMethodId) return null;

  const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
  return pm.card?.fingerprint ?? null;
}

// =============================================================================
// Sync
// =============================================================================

async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const userId = sub.metadata?.userId;
  if (!userId) {
    // eslint-disable-next-line no-console
    console.error('[stripe-webhook] subscription without userId metadata', {
      subscriptionId: sub.id,
    });
    return;
  }

  const customerId =
    typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

  const item = sub.items.data[0];

  await upsertSubscription({
    userId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: sub.id,
    status: sub.status as SubscriptionStatus,
    priceId: item?.price?.id ?? null,
    currentPeriodEnd: toDate(item?.current_period_end),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    trialEnd: toDate(sub.trial_end),
  });
}

function toDate(unixSeconds: number | null | undefined): Date | null {
  return typeof unixSeconds === 'number' ? new Date(unixSeconds * 1000) : null;
}