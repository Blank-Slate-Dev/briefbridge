// app/_components/public-footer.tsx
//
// Shared footer for every page in the (public) route group. Extracted from
// the homepage so all public pages (legislation, cases, privacy, terms)
// carry the same chrome. Anchor links are absolute (/#how) so they work
// from any page, not just the homepage.

import Image from 'next/image';
import Link from 'next/link';

export function PublicFooter() {
  return (
    <footer className="bb-footer">
      <div className="bb-footer-inner">
        <div className="bb-footer-brand">
          <Link href="/" className="bb-brand" aria-label="BriefBridge">
            <Image
              src="/logo.png"
              alt="BriefBridge"
              width={270}
              height={90}
              className="bb-brand-logo"
            />
          </Link>
          <p>
            The legal research partner for Australian lawyers. Built in
            Newcastle, NSW.
          </p>
        </div>
        <div className="bb-footer-col">
          <h4>Product</h4>
          <ul>
            <li><Link href="/#how">How it works</Link></li>
            <li><Link href="/#coverage">Coverage</Link></li>
            <li><Link href="/cases">Cases</Link></li>
            <li><Link href="/legislation">Legislation</Link></li>
          </ul>
        </div>
        <div className="bb-footer-col">
          <h4>Company</h4>
          <ul>
            <li><a href="mailto:osr9915@gmail.com">Contact</a></li>
          </ul>
        </div>
        <div className="bb-footer-col">
          <h4>Legal</h4>
          <ul>
            <li><Link href="/privacy">Privacy</Link></li>
            <li><Link href="/terms">Terms</Link></li>
            <li><Link href="/legislation">Source attribution</Link></li>
          </ul>
        </div>
      </div>
      <div className="bb-footer-bottom">
        <span>© 2026 BriefBridge. All rights reserved.</span>
        <span>Made in Australia 🇦🇺</span>
      </div>
    </footer>
  );
}