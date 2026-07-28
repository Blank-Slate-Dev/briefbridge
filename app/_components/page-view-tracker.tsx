// app/_components/page-view-tracker.tsx
//
// Reports a page view whenever the pathname changes.
//
// =============================================================================
// WHY usePathname AND NOT useSearchParams
// =============================================================================
//
// useSearchParams forces every page that renders this into client-side
// rendering unless it is wrapped in <Suspense> — a real cost, applied to the
// whole site, for information this tracker deliberately throws away anyway
// (the server strips query strings before storing). Watching the pathname
// alone keeps the root layout statically renderable.
//
// The side effect is that /chat?conversationId=a → /chat?conversationId=b
// counts as one view rather than two. That is the correct count for what this
// measures: which PAGES people reach, not how many conversations they open —
// which is already tracked properly as chat_query events.
//
// Renders nothing. Fire-and-forget: the action is not awaited, so a slow or
// failing insert can never delay a navigation the user is watching.

'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { trackPageViewAction } from '../_actions/track';

export function PageViewTracker() {
  const pathname = usePathname();

  // React runs effects twice in development StrictMode, and a remount on the
  // same path would double-count. Recording the last path sent makes the
  // tracker idempotent per path.
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname) return;
    if (lastSent.current === pathname) return;
    lastSent.current = pathname;

    void trackPageViewAction(pathname);
  }, [pathname]);

  return null;
}