// app/_components/sticky-header.tsx
'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';

// Auth state is resolved on the SERVER (in app/page.tsx via getUser) and
// passed down as a prop, because this is a Client Component (it needs the
// scroll listener) and can't call getUser() itself. When isLoggedIn is true
// we show a single "Go to app" link to /matters; otherwise the "Sign in" CTA.
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
            width={180}
            height={42}
            className="bb-brand-logo"
            priority
          />
        </Link>
        <div className="bb-nav-links">
          <Link href="#how">How it works</Link>
          <Link href="#coverage">Coverage</Link>
          <Link href="/cases">Cases</Link>
        </div>
        <div className="bb-nav-cta">
          {isLoggedIn ? (
            // Signed in: one clear action — into the app.
            <Link href="/matters" className="bb-btn bb-btn-primary">
              Go to app →
            </Link>
          ) : (
            // Signed out: route to /login (signed-in users get redirected
            // away by the proxy automatically).
            <Link href="/login" className="bb-btn bb-btn-primary">
              Sign in →
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
