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
// figure the user reads is the server's date, not their device clock.
//
// Whether the yearly plan is OFFERED is decided here too: if
// STRIPE_PRICE_ID_YEARLY isn't configured the chooser collapses to a single
// monthly card rather than showing a plan that can't be bought.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import {
  getAccessState,
  getSubscription,
} from '@/lib/db/queries/subscription';
import { listInvoices } from '@/lib/billing/invoices';
import { TRIAL_DAYS, STRIPE_PRICE_ID_YEARLY, hasYearlyPrice } from '@/lib/stripe';
import { BillingClient } from './_components/billing-client';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Billing' };

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

  // What the card would be charged if they started a trial right now.
  const projectedChargeDate = new Date(
    Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

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
        activePriceId={subscription?.priceId ?? null}
        yearlyPriceId={STRIPE_PRICE_ID_YEARLY}
      />
    </main>
  );
}