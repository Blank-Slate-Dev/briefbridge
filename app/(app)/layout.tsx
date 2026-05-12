// app/(app)/layout.tsx
//
// (app) group layout — shared across /chat, /matters, etc.
//
// Server Component. Authenticates the user, fetches matters AND recent
// conversations server-side, then renders the shell (sidebar + main).
//
// What changed in Chunk 5:
//   - Also fetches `listConversations(user.id, { limit: 5 })` for the
//     sidebar's "Recent research" section.
//   - Passes the result to AppSidebar as `recentResearch`.
//
// IMPORTANT — IF YOUR LOCAL layout.tsx DIFFERS FROM THIS:
// The Chunk 5 zip includes this drop-in replacement. If your current
// layout.tsx has additional logic I'm not aware of (e.g. custom providers,
// extra contexts), MERGE manually: keep your additions, just add the
// `recentResearch` fetch + prop. The two new lines are:
//
//   const recentResearch = await listConversations(user.id, { limit: 5 });
//   <AppSidebar user={...} recentResearch={recentResearch} />
//
// Everything else here should match what you already have. If it doesn't,
// don't blindly overwrite — diff and merge.

import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { createClient } from '@/lib/supabase/server';
import { listMattersForUser } from '@/lib/db/queries/matters';
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
          recentResearch={recentResearch}
        />
        <main className="bb-shell-main">{children}</main>
      </div>
    </MattersProvider>
  );
}
