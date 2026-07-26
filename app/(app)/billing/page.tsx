// app/(app)/billing/page.tsx
//
// Billing: subscribe, or manage an existing subscription.
//
// Deliberately thin. Card details, invoices, plan changes and cancellation all
// live in Stripe's hosted Checkout and Customer Portal — rebuilding any of
// that would mean handling card data and reimplementing dunning for no gain.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getAccessState } from '@/lib/db/queries/subscription';
import { TRIAL_DAYS } from '@/lib/stripe';
import { BillingClient } from './_components/billing-client';

export const dynamic = 'force-dynamic';

const NAVY = '#1a1f2e';
const SOFT = '#3a4256';
const MUTED = '#8a8577';

export default async function BillingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/billing');

  const access = await getAccessState(user.id);

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '56px 32px 96px', color: SOFT }}>
      <div
        style={{
          fontSize: 11,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: MUTED,
          marginBottom: 12,
        }}
      >
        Billing
      </div>
      <h1
        style={{
          fontFamily: 'var(--font-fraunces), Georgia, serif',
          fontSize: 'clamp(30px, 4vw, 42px)',
          lineHeight: 1.1,
          letterSpacing: '-0.03em',
          color: NAVY,
          fontWeight: 400,
          margin: '0 0 28px',
        }}
      >
        Your subscription
      </h1>

      <BillingClient
        hasAccess={access.hasAccess}
        status={access.status}
        isTrialing={access.isTrialing}
        trialEnd={access.trialEnd?.toISOString() ?? null}
        currentPeriodEnd={access.currentPeriodEnd?.toISOString() ?? null}
        cancelAtPeriodEnd={access.cancelAtPeriodEnd}
        trialDays={TRIAL_DAYS}
      />
    </main>
  );
}