// app/(app)/settings/page.tsx
//
// Settings — practitioner profile (which shapes how chat answers are written,
// see lib/practitioner/types.ts) and subscription state.
//
// Server Component: authenticates, then loads the profile and the entitlement
// in ONE parallel wave. Both are single indexed reads; running them serially
// would add a needless round trip to Singapore on every visit.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getPractitionerProfile } from '@/lib/db/queries/profile';
import { getAccessState } from '@/lib/db/queries/subscription';
import { PractitionerSettingsForm } from './_components/practitioner-settings-form';
import { SubscriptionCard } from './_components/subscription-card';

export const dynamic = 'force-dynamic';

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
          Your <em>practice</em>
        </h1>
        <p className="bb-settings-sub">
          BriefBridge shapes its answers around how you practise. A barrister
          gets authorities and counter-arguments; a solicitor gets advice
          framing and next steps. This never changes which law is searched —
          only how the answer is written.
        </p>
      </header>

      <PractitionerSettingsForm
        initialType={profile.practitionerType}
        initialAreas={profile.practiceAreas}
      />

      <div style={{ marginTop: 20 }}>
        <SubscriptionCard
          hasAccess={access.hasAccess}
          status={access.status}
          isTrialing={access.isTrialing}
          trialEnd={access.trialEnd?.toISOString() ?? null}
          currentPeriodEnd={access.currentPeriodEnd?.toISOString() ?? null}
          cancelAtPeriodEnd={access.cancelAtPeriodEnd}
        />
      </div>
    </main>
  );
}