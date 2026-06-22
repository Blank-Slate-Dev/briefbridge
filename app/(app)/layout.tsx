// app/(app)/layout.tsx
//
// (app) group layout — shared across /chat, /matters, etc.
//
// Server Component. Authenticates the user, fetches matters AND recent
// conversations server-side, then renders the shell (sidebar + main).
//
// MULTI-FIRM: also resolves the user's PERSONAL firm id and passes it to the
// sidebar so it can split matters into "My cases" (personal firm) and "Firm
// cases" (shared firms). The provider keeps the flat matters list; the bucket
// split happens at the display layer (sidebar + matters page) using firmId.
//
// What changed in Chunk 5:
//   - Also fetches `listConversations(user.id, { limit: 5 })` for the
//     sidebar's "Recent research" section.
//   - Passes the result to AppSidebar as `recentResearch`.

import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { createClient } from '@/lib/supabase/server';
import { listMattersForUser } from '@/lib/db/queries/matters';
import { getUserPersonalFirmId } from '@/lib/db/queries/access';
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

  // Resolve the user's personal firm id so the sidebar can bucket matters into
  // "My cases" (firmId === personalFirmId) vs "Firm cases" (everything else).
  const personalFirmId = await getUserPersonalFirmId(user.id);

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
          recentResearch={recentResearch}
        />
        <main className="bb-shell-main">{children}</main>
      </div>
    </MattersProvider>
  );
}
