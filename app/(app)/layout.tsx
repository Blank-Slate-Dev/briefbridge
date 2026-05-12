// app/(app)/layout.tsx
//
// This layout wraps every page inside the (app) route group: /chat, /matters,
// /matters/[id], and (later) any other authenticated workspace pages.
//
// It does NOT wrap marketing pages like the homepage. The route group's
// parentheses mean "no URL segment added" — /chat is still /chat.
//
// The sidebar is collapsed by default and expands on hover/focus on desktop.
// On mobile it becomes a slide-out drawer triggered by a hamburger button
// (rendered inside the AppSidebar component itself).
//
// MattersProvider wraps children so the sidebar's case list, the matters
// list, and the matter detail page all read from the same client-side
// state and reflect status changes live. State is in-memory only until the
// real DB lands.
//
// AUTH (Chunk 2):
// We fetch the authenticated user here on the server, derive the email +
// display name, and pass them to the AppSidebar so the user button can
// render the right state. The middleware already gates this whole route
// group behind authentication, so by the time we render this layout the
// user is guaranteed to exist — but we still pass `null` defensively if
// the call returns no user, and AppSidebar handles that by rendering the
// "Sign in" link variant.

import { createClient } from '@/lib/supabase/server';
import { AppSidebar } from './_components/app-sidebar';
import { MattersProvider } from './matters/_components/matters-provider';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Authoritative user lookup. getUser() validates the JWT against the
  // Supabase auth server (NOT just decoding the cookie locally) — same
  // pattern as the middleware. This is the trusted source of identity.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Pull out a clean shape for the sidebar — email + display name only.
  // Google OAuth users have user_metadata.full_name or .name; password
  // users typically have neither and we fall back to the email's local part.
  const sidebarUser = user
    ? {
        email: user.email ?? '',
        displayName:
          (user.user_metadata?.full_name as string | undefined) ??
          (user.user_metadata?.name as string | undefined) ??
          null,
      }
    : null;

  return (
    <MattersProvider>
      <div className="bb-shell">
        <AppSidebar user={sidebarUser} />
        <div className="bb-shell-main">{children}</div>
      </div>
    </MattersProvider>
  );
}
