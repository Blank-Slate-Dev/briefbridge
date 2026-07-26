// app/_components/sticky-header.tsx
'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';

// Shared public-shell header. Rendered by app/(public)/layout.tsx on every
// public page, so:
//   - anchor links are absolute (/#how) — they navigate home first when
//     clicked from /legislation, /privacy etc.
//   - isLoggedIn defaults to false and the layout does NOT resolve auth:
//     calling getUser() in the shared layout would force-dynamic every
//     ISR-cached legislation page (12k+ pages) and destroy the SEO caching.
//     Signed-in users who click "Sign in" are bounced straight to /matters
//     by the proxy, so the default CTA is safe for them too.
//
// LOGO SIZING: logo.png is 2172×724 (3:1). The width/height props MUST
// match that ratio or the browser distorts the render (reads as blur) and
// logs the "width or height modified" warning. 270×90 keeps 3:1 and makes
// next/image serve a ≥540px variant — crisp on high-DPI/4K displays. The
// DISPLAY size is governed by .bb-brand-logo in CSS (height: 38px; width:
// auto), not by these props.
export function StickyHeader({ isLoggedIn = false }: { isLoggedIn?: boolean }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`bb-header ${scrolled ? 'bb-header-scrolled' : ''}`}>
      <nav className="bb-nav">
        <Link href="/" className="bb-brand" aria-label="BriefBridge">
          <Image
            src="/logo.png"
            alt="BriefBridge"
            width={270}
            height={90}
            className="bb-brand-logo"
            priority
          />
        </Link>
        <div className="bb-nav-links">
          <Link href="/demo">See it work</Link>
          <Link href="/#how">How it works</Link>
          <Link href="/#coverage">Coverage</Link>
          <Link href="/cases">Cases</Link>
          <Link href="/legislation">Legislation</Link>
        </div>
        <div className="bb-nav-cta">
          {isLoggedIn ? (
            <Link href="/matters" className="bb-btn bb-btn-primary">
              Go to app →
            </Link>
          ) : (
            <Link href="/login" className="bb-btn bb-btn-primary">
              Sign in →
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
