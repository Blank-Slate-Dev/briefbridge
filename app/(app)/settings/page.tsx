// app/(app)/settings/page.tsx
//
// Settings — currently just the practitioner profile, which shapes how chat
// answers are written (see lib/practitioner/types.ts).
//
// Server Component: authenticates, loads the profile in one query, hands it
// to the client form as initial state so there is no client fetch on mount.

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getPractitionerProfile } from '@/lib/db/queries/profile';
import { PractitionerSettingsForm } from './_components/practitioner-settings-form';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect('/login?next=/settings');
  }

  const profile = await getPractitionerProfile(user.id);

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
    </main>
  );
}