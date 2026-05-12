// app/_components/sticky-header.tsx
'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';

export function StickyHeader() {
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
          <Link href="#">Pricing</Link>
          <Link href="#">FAQ</Link>
        </div>
        <div className="bb-nav-cta">
          {/* Sign in routes straight to /login (signed-in users get
              redirected away by the middleware automatically). */}
          <Link href="/login" className="bb-btn bb-btn-ghost">
            Sign in
          </Link>
          {/* "Join waitlist" stays as a hash anchor for the in-page waitlist
              section. When we ship a real waitlist or open up signup, we
              can swap this to /login?mode=signup. */}
          <Link href="#waitlist" className="bb-btn bb-btn-primary">
            Join waitlist
          </Link>
        </div>
      </nav>
    </header>
  );
}
