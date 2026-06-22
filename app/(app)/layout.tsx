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
// What changed in Chunk 5:
//   - Also fetches `listConversations(user.id, { limit: 5 })` for the
//     sidebar's "Recent research" section.

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

  // Fetch matters for the sidebar + MattersProvider's initial state.
  const matters = await listMattersForUser(user.id);

  // Resolve the user's personal firm id (for the My/Firm cases split) and all
  // their memberships (to derive hasSharedFirm for the Upgrade affordance).
  const [personalFirmId, memberships] = await Promise.all([
    getUserPersonalFirmId(user.id),
    getUserFirmMemberships(user.id),
  ]);

  // hasSharedFirm = the user belongs to at least one NON-personal firm.
  const hasSharedFirm = memberships.some((m) => !m.isPersonal);

  // Fetch recent conversations for the sidebar's "Recent research" section.
  // Limit 5 — sidebar is narrow and lists more than that get noisy.
  // No matter filter → returns conversations across all matters + standalone.
  const recentResearch = await listConversations(user.id, { limit: 5 });

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
