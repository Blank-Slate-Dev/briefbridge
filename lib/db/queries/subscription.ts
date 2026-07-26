// lib/db/queries/subscription.ts
//
// Local mirror of Stripe subscription state, plus the trial-fingerprint
// ledger.
//
// Stripe is the source of truth; this table exists so that gating a page costs
// one indexed read instead of a network round trip to Stripe on every request.
// The webhook keeps it in sync.
//
// These functions use the plain app connection (not withUser): the webhook has
// no user session, and the tables carry no RLS for that reason. Every read is
// constrained on the caller-supplied userId instead.

import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  subscriptions,
  trialFingerprints,
  type Subscription,
  type SubscriptionStatus,
} from '@/lib/db/schema';

/** Statuses that entitle a user to use the product. */
const ENTITLED: SubscriptionStatus[] = ['trialing', 'active'];

export interface AccessState {
  hasAccess: boolean;
  status: SubscriptionStatus | null;
  /** True while in a free trial. */
  isTrialing: boolean;
  /** When the trial ends, if trialing. */
  trialEnd: Date | null;
  /** End of the paid period — access persists to here even if cancelled. */
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  stripeCustomerId: string | null;
}

export const NO_ACCESS: AccessState = {
  hasAccess: false,
  status: null,
  isTrialing: false,
  trialEnd: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  stripeCustomerId: null,
};

/**
 * The user's current entitlement.
 *
 * Access rule: entitled if the status is trialing/active, OR if the status is
 * cancelled/past-due but the paid period hasn't elapsed — someone who cancels
 * on day 3 keeps the month they paid for. Anything else is no access.
 *
 * Never throws: on a database error the caller gets NO_ACCESS, which fails
 * closed rather than handing out free access.
 */
export async function getAccessState(userId: string): Promise<AccessState> {
  try {
    const [row] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .limit(1);

    if (!row) return NO_ACCESS;

    const periodStillRunning =
      row.currentPeriodEnd !== null && row.currentPeriodEnd > new Date();

    return {
      hasAccess: ENTITLED.includes(row.status) || periodStillRunning,
      status: row.status,
      isTrialing: row.status === 'trialing',
      trialEnd: row.trialEnd,
      currentPeriodEnd: row.currentPeriodEnd,
      cancelAtPeriodEnd: row.cancelAtPeriodEnd,
      stripeCustomerId: row.stripeCustomerId,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      '[subscription] getAccessState failed:',
      err instanceof Error ? err.message : String(err),
    );
    return NO_ACCESS;
  }
}

/** Raw row, for the billing page and the webhook. */
export async function getSubscription(
  userId: string,
): Promise<Subscription | null> {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  return row ?? null;
}

/** Look up by Stripe customer id — the webhook's entry point. */
export async function getSubscriptionByCustomerId(
  stripeCustomerId: string,
): Promise<Subscription | null> {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeCustomerId, stripeCustomerId))
    .limit(1);
  return row ?? null;
}

/**
 * Upsert the local mirror from Stripe state. Called by the webhook.
 */
export async function upsertSubscription(input: {
  userId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  status: SubscriptionStatus;
  priceId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialEnd: Date | null;
}): Promise<void> {
  await db
    .insert(subscriptions)
    .values({ ...input, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: subscriptions.userId,
      set: {
        stripeCustomerId: input.stripeCustomerId,
        stripeSubscriptionId: input.stripeSubscriptionId,
        status: input.status,
        priceId: input.priceId,
        currentPeriodEnd: input.currentPeriodEnd,
        cancelAtPeriodEnd: input.cancelAtPeriodEnd,
        trialEnd: input.trialEnd,
        updatedAt: new Date(),
      },
    });
}

// =============================================================================
// Trial fingerprints
// =============================================================================

/**
 * Has this card already had a free trial?
 *
 * Stripe assigns each card a stable fingerprint, identical across customers
 * within an account, so this catches someone deleting an account and signing
 * up again with the same card. It does not catch a second card — the aim is to
 * stop casual recycling, not to be unbeatable.
 *
 * Fails OPEN (returns false) on error: wrongly denying a paying customer their
 * advertised trial is worse than occasionally granting one twice.
 */
export async function hasUsedTrial(fingerprint: string): Promise<boolean> {
  try {
    const [row] = await db
      .select({ id: trialFingerprints.id })
      .from(trialFingerprints)
      .where(eq(trialFingerprints.fingerprint, fingerprint))
      .limit(1);
    return Boolean(row);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      '[subscription] hasUsedTrial failed, allowing trial:',
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

/** Records that a card has consumed a trial. Idempotent. */
export async function recordTrialFingerprint(
  fingerprint: string,
  userId: string,
): Promise<void> {
  try {
    await db
      .insert(trialFingerprints)
      .values({ fingerprint, firstUserId: userId })
      .onConflictDoNothing({ target: trialFingerprints.fingerprint });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      '[subscription] recordTrialFingerprint failed:',
      err instanceof Error ? err.message : String(err),
    );
  }
}