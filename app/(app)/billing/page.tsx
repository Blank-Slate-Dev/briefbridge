// app/(app)/billing/page.tsx
//
// Billing. Shares the account surface with /settings (settings.css) so the
// two read as one product.
//
// Server Component. Loads entitlement, then invoices — serially, because the
// invoice lookup needs the Stripe customer id that the first query returns.
// Both are cheap and only run when someone opens billing.
//
// The trial charge date is computed HERE rather than in the client so the
// figure the user reads is the server's date, not their device clock. A
// wrong charge date is exactly the kind of small inaccuracy this audience
// checks, and a device with a skewed clock would produce one.
//
// Which plans are OFFERED is decided here too: if STRIPE_PRICE_ID_YEARLY isn't
// configured the interval chooser collapses to a single monthly card, and if
// the firm prices aren't configured the Individual/Firm control is hidden
// entirely. Showing a plan that can't be bought is worse than not showing it.
//
// The active subscription's price id is resolved to a family and interval HERE
// rather than in the client, which keeps all four Stripe price ids out of the
// browser bundle.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import {
  getAccessState,
  getSubscription,
} from '@/lib/db/queries/subscription';
import { listInvoices } from '@/lib/billing/invoices';
import { TRIAL_DAYS, hasYearlyPrice, hasFirmPricing, priceIdMap } from '@/lib/stripe';
import { BillingClient } from './_components/billing-client';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Billing' };

/**
 * When the card would first be charged if a trial started right now.
 *
 * Deliberately outside the component, with the purity rule disabled.
 *
 * react-hooks/purity forbids impure calls like Date.now() during render,
 * because in a CLIENT component an unexpected re-render would silently change
 * the value. That reasoning doesn't apply here: this is a Server Component
 * marked force-dynamic, so it renders exactly once per request, on the
 * server, and the current time is precisely what we want. The lint rule
 * cannot tell the two cases apart.
 *
 * The alternative — computing the date in the browser — is worse: it would
 * read the visitor's device clock, and a skewed clock would print a charge
 * date that doesn't match what Stripe actually does.
 */
function projectedTrialChargeDate(trialDays: number): string {
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  return new Date(now + trialDays * 24 * 60 * 60 * 1000).toISOString();
}

export default async function BillingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/billing');

  const [access, subscription] = await Promise.all([
    getAccessState(user.id),
    getSubscription(user.id),
  ]);
  const invoices = await listInvoices(access.stripeCustomerId);

  const projectedChargeDate = projectedTrialChargeDate(TRIAL_DAYS);

  // null when the subscription is on a price id we no longer recognise — an
  // old price, or one created directly in the dashboard. The client renders a
  // neutral label rather than asserting something it can't verify.
  const activePlan = subscription?.priceId
    ? (priceIdMap()[subscription.priceId] ?? null)
    : null;

  return (
    <main className="bb-account-main">
      <header className="bb-account-head">
        <div className="bb-section-eyebrow">Billing</div>
        <h1 className="bb-account-title">
          Your <em>subscription</em>
        </h1>
      </header>

      <BillingClient
        hasAccess={access.hasAccess}
        status={access.status}
        isTrialing={access.isTrialing}
        trialEnd={access.trialEnd?.toISOString() ?? null}
        currentPeriodEnd={access.currentPeriodEnd?.toISOString() ?? null}
        cancelAtPeriodEnd={access.cancelAtPeriodEnd}
        trialDays={TRIAL_DAYS}
        projectedChargeDate={projectedChargeDate}
        invoices={invoices}
        yearlyAvailable={hasYearlyPrice()}
        firmAvailable={hasFirmPricing()}
        activePlan={activePlan}
      />
    </main>
  );
}
