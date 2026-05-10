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

import { AppSidebar } from './_components/app-sidebar';
import { MattersProvider } from './matters/_components/matters-provider';

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <MattersProvider>
      <div className="bb-shell">
        <AppSidebar />
        <div className="bb-shell-main">{children}</div>
      </div>
    </MattersProvider>
  );
}
