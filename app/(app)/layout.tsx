// app/(app)/layout.tsx
//
// This layout wraps every page inside the (app) route group: /chat, /matters,
// /matters/[id], and (later) any other authenticated workspace pages.
//
// What changed in Chunk 3:
//   - We now fetch the user's matters server-side and seed the
//     MattersProvider with them. The sidebar's case list, the matters
//     page cards, and the matter detail page all read from the same
//     provider state — so a status change on the detail page reflects
//     instantly in the sidebar without a full page refresh.
//
// AUTH (unchanged from Chunk 2):
//   We fetch the authenticated user here on the server, derive email +
//   display name, and pass them to the AppSidebar so the user button
//   renders the right state. Middleware gates this whole route group
//   behind authentication.

import { createClient } from '@/lib/supabase/server';
import { listMattersForUser } from '@/lib/db/queries/matters';
import { AppSidebar } from './_components/app-sidebar';
import { MattersProvider } from './matters/_components/matters-provider';

// Force dynamic — this layout is per-user.
export const dynamic = 'force-dynamic';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Authoritative user lookup. getUser() validates the JWT against the
  // Supabase auth server (NOT just decoding the cookie locally).
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Shape the user for the sidebar.
  const sidebarUser = user
    ? {
        email: user.email ?? '',
        displayName:
          (user.user_metadata?.full_name as string | undefined) ??
          (user.user_metadata?.name as string | undefined) ??
          null,
      }
    : null;

  // Fetch the user's matters for the provider. If unauthenticated (which
  // shouldn't happen here, but defensively) just hand an empty array — the
  // provider tolerates that.
  //
  // Performance note: this runs on every (app)-group navigation. Two
  // mitigations make it cheap:
  //   1. We have a (user_id, archived_at) index, so the filter is fast.
  //   2. We're inside a server component, so the result is fetched at
  //      navigation time without a client round-trip.
  // If this ever shows up in a profile, the answer is to move the matters
  // fetch into a parallel route segment with its own caching. For now,
  // the cost is negligible compared to the auth round-trip we're already
  // doing above.
  const initialMatters = user ? await listMattersForUser(user.id) : [];

  return (
    <MattersProvider initialMatters={initialMatters}>
      <div className="bb-shell">
        <AppSidebar user={sidebarUser} />
        <div className="bb-shell-main">{children}</div>
      </div>
    </MattersProvider>
  );
}
