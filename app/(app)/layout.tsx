// app/(app)/layout.tsx
//
// (app) group layout — shared across /chat, /matters, etc.
//
// Server Component. Authenticates the user, fetches matters AND recent
// conversations server-side, then renders the shell (sidebar + main).
//
// MULTI-FIRM:
//   - Resolves the user's PERSONAL firm id (for the My/Firm cases split).
//   - Derives hasSharedFirm (does the user belong to any non-personal firm?)
//     so the sidebar can show/hide the "Upgrade to a firm" affordance.
//   - Both come from access.ts helpers; the provider keeps the flat matters
//     list and the bucket split happens in the sidebar.
//
// PERFORMANCE (latency waterfall):
//   The DB round trip dominates page cost (~110ms/query to Singapore;
//   ~15ms after the Sydney migration). Every serial "wave" of queries pays
//   that full round trip again. None of the four data fetches below depend
//   on each other — only on user.id — so they run in ONE Promise.all wave:
//     BEFORE: auth → matters → [firm pair] → conversations  (4 waves)
//     AFTER:  auth → [matters + firmId + memberships + conversations] (2)

import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { createClient } from '@/lib/supabase/server';
import { listMattersForUser } from '@/lib/db/queries/matters';
import {
  getUserPersonalFirmId,
  getUserFirmMemberships,
} from '@/lib/db/queries/access';
import { listConversations } from '@/lib/db/queries/conversations';
import { AppSidebar } from './_components/app-sidebar';
import { MattersProvider } from './matters/_components/matters-provider';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // ONE parallel wave: matters (sidebar + provider), personal firm id +
  // memberships (My/Firm split + upgrade affordance), and recent
  // conversations (sidebar "Recent research", limit 5 — lists longer than
  // that get noisy in a narrow sidebar).
  const [matters, personalFirmId, memberships, recentResearch] =
    await Promise.all([
      listMattersForUser(user.id),
      getUserPersonalFirmId(user.id),
      getUserFirmMemberships(user.id),
      listConversations(user.id, { limit: 5 }),
    ]);

  // hasSharedFirm = the user belongs to at least one NON-personal firm.
  const hasSharedFirm = memberships.some((m) => !m.isPersonal);

  // Pull display name from user metadata or email local-part as fallback.
  const displayName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    user.email?.split('@')[0] ??
    null;

  return (
    <MattersProvider initialMatters={matters}>
      <div className="bb-shell">
        <AppSidebar
          user={{
            email: user.email ?? '',
            displayName,
          }}
          personalFirmId={personalFirmId}
          hasSharedFirm={hasSharedFirm}
          recentResearch={recentResearch}
        />
        <main className="bb-shell-main">{children}</main>
      </div>
    </MattersProvider>
  );
}
