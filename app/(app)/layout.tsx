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

import { AppSidebar } from './_components/app-sidebar';

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="bb-shell">
      <AppSidebar />
      <div className="bb-shell-main">{children}</div>
    </div>
  );
}
