// app/(app)/settings/page.tsx
//
// Settings — subscription state and the practitioner profile (which shapes
// how answers are written, see lib/practitioner/types.ts).
//
// =============================================================================
// ORDER: SUBSCRIPTION FIRST
// =============================================================================
//
// It used to sit under the whole practice form, which meant scrolling past
// eighteen practice areas to find out when you'd next be charged. That is
// backwards: subscription is the thing people OPEN this page to check, while
// the practice profile is something they set once and rarely revisit.
//
// It is also one short row against a long form, so putting it first costs the
// form almost nothing — the practice settings still start above the fold.
//
// DIVISION OF LABOUR WITH /billing: this page owns MANAGEMENT of an existing
// subscription — status, cancel, resume. /billing owns ACQUISITION — the plan
// chooser, the payment form, and invoice history. Two surfaces that both did
// everything would compete; splitting on that line gives each one job.
//
// Server Component: authenticates, then loads the profile and entitlement in
// ONE parallel wave. Both are single indexed reads; running them serially
// would add a needless round trip on every visit.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getPractitionerProfile } from '@/lib/db/queries/profile';
import { getAccessState } from '@/lib/db/queries/subscription';
import { PractitionerSettingsForm } from './_components/practitioner-settings-form';
import { SubscriptionCard } from './_components/subscription-card';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login?next=/settings');
  }

  const [profile, access] = await Promise.all([
    getPractitionerProfile(user.id),
    getAccessState(user.id),
  ]);

  return (
    <main className="bb-settings-main">
      <header className="bb-settings-head">
        <div className="bb-section-eyebrow">Settings</div>
        <h1 className="bb-settings-title">
          Your <em>account</em>
        </h1>
        <p className="bb-settings-sub">
          Your subscription, and how BriefBridge shapes its answers around the
          way you practise. Practice settings never change which law is
          searched — only how the answer is written.
        </p>
      </header>

      <SubscriptionCard
        hasAccess={access.hasAccess}
        status={access.status}
        isTrialing={access.isTrialing}
        trialEnd={access.trialEnd?.toISOString() ?? null}
        currentPeriodEnd={access.currentPeriodEnd?.toISOString() ?? null}
        cancelAtPeriodEnd={access.cancelAtPeriodEnd}
      />

      <PractitionerSettingsForm
        initialType={profile.practitionerType}
        initialAreas={profile.practiceAreas}
      />
    </main>
  );
}