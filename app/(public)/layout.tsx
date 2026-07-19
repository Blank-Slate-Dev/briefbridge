// app/(public)/layout.tsx
//
// PUBLIC SHELL — sticky header + footer around every public page
// (homepage, /legislation/*, /cases, /privacy, /terms).
//
// Deliberately NOT async and does NOT resolve auth: any per-request work
// here would force-dynamic the whole group, including the 12k+ ISR-cached
// legislation pages the SEO build depends on. The header shows the
// signed-out CTA by default; the proxy redirects signed-in users who click
// it, and the homepage separately redirects signed-in visitors to
// /matters.
//
// URLs are unchanged by the route group — (public) is invisible in paths.

import type { ReactNode } from 'react';
import { StickyHeader } from '../_components/sticky-header';
import { PublicFooter } from '../_components/public-footer';

export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <StickyHeader />
      {children}
      <PublicFooter />
    </>
  );
}