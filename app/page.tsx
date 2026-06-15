// app/page.tsx
import Image from 'next/image';
import Link from 'next/link';
import { StickyHeader } from './_components/sticky-header';
import { HeroPreview } from './_components/hero-preview';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

// The homepage is public, but it reads auth state so the header can show
// "Go to app" to signed-in users instead of "Sign in". getUser() validates
// the session against Supabase (not just the cookie), so it's the safe check.
// force-dynamic because the header now depends on per-request auth state.
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
} = await supabase.auth.getUser();

  // Logged-in users don't need the marketing homepage — send them straight
  // to their workspace. Must be outside any try/catch (redirect throws).
  if (user) {
    redirect('/matters');
  }

  const isLoggedIn = !!user;

  return (
    <>
      <StickyHeader isLoggedIn={isLoggedIn} />

      {/* === HERO === */}
      <section className="bb-hero">
        <div className="bb-hero-eyebrow">Now indexing NSW Supreme Court</div>
        <h1 className="bb-hero-title">
          The legal research partner
          <br />
          for <em>Australian lawyers</em>
        </h1>
        <p className="bb-hero-sub">
          Search Australian case law by what it means, not what it says. Every
          answer is grounded in the source, paragraph by paragraph.
        </p>
        <div className="bb-hero-cta">
          {isLoggedIn ? (
            <Link href="/matters" className="bb-btn bb-btn-primary bb-btn-large">
              Go to app →
            </Link>
          ) : (
            <Link href="/login" className="bb-btn bb-btn-primary bb-btn-large">
              Sign in →
            </Link>
          )}
          <Link href="#how" className="bb-btn bb-btn-ghost bb-btn-large">
            See how it works
          </Link>
        </div>
      </section>

      {/* === PRODUCT PREVIEW === */}
      {/* The inner content is now an animated client component that cycles
          through real research queries. The outer chrome stays here. */}
      <div className="bb-preview-wrap">
        <div className="bb-preview">
          <HeroPreview />
        </div>
      </div>

      {/* === PROBLEM === */}
      <section className="bb-section" id="problem">
        <div className="bb-section-eyebrow">
          Built for the way lawyers actually work
        </div>
        <h2 className="bb-section-title">
          Legal research <em>shouldn&apos;t</em> feel like archaeology.
        </h2>
        <p className="bb-section-sub">
          Australian lawyers spend hours on Boolean queries, scrolling AustLII,
          and verifying every citation by hand. There is a better way.
        </p>
        <div className="bb-problem-grid">
          <div className="bb-problem-card">
            <div className="bb-problem-num">i.</div>
            <h3>Search by meaning</h3>
            <p>
              Ask in plain English. &ldquo;Costs apportionment when one claim
              is undetermined&rdquo; finds the right judgments — not just ones
              containing those exact words.
            </p>
          </div>
          <div className="bb-problem-card">
            <div className="bb-problem-num">ii.</div>
            <h3>Grounded answers</h3>
            <p>
              Every answer points to the exact paragraph it came from. No
              invented quotes. No hallucinated citations. Click through and
              verify in one tap.
            </p>
          </div>
          <div className="bb-problem-card">
            <div className="bb-problem-num">iii.</div>
            <h3>Australian-first</h3>
            <p>
              NSW, Victoria, Queensland, Federal Court, High Court. Built for
              Commonwealth jurisdictions — not retrofitted from a US-trained
              model.
            </p>
          </div>
        </div>
      </section>

      {/* === HOW IT WORKS === */}
      <section className="bb-features" id="how">
        <div className="bb-features-inner">
          <div className="bb-section-eyebrow">How it works</div>
          <h2 className="bb-section-title">
            From fact pattern <em>to authority,</em>
            <br />
            in seconds.
          </h2>
          <p className="bb-section-sub">
            A research workflow that respects how lawyers actually think — not
            how a search engine indexes documents.
          </p>
          <div className="bb-features-grid">
            <div className="bb-feature">
              <div className="bb-feature-icon">a</div>
              <h3>Describe the issue</h3>
              <p>
                Paste your client&apos;s facts, type a legal question, or drop
                in a draft submission. BriefBridge understands the legal
                context.
              </p>
            </div>
            <div className="bb-feature">
              <div className="bb-feature-icon">b</div>
              <h3>Read the relevant judgments</h3>
              <p>
                The most on-point cases surface first, with the specific
                paragraphs that matter highlighted. Every word is verifiable.
              </p>
            </div>
            <div className="bb-feature">
              <div className="bb-feature-icon">c</div>
              <h3>Cite with confidence</h3>
              <p>
                Every cited paragraph is addressable. Copy citations in
                Australian Guide to Legal Citation format, ready for your
                written submissions.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* === COVERAGE === */}
      <section className="bb-section" id="coverage">
        <div className="bb-section-eyebrow">Coverage</div>
        <h2 className="bb-section-title">
          Starting with NSW. <em>Australia next.</em>
        </h2>
        <p className="bb-section-sub">
          We&apos;re building court-by-court, with full text and structured
          metadata. No black-box scraping — direct ingestion with court
          permission.
        </p>
        <div className="bb-coverage">
          <div className="bb-coverage-list">
            <CoverageRow name="NSW Supreme Court" status="Live" tone="live" />
            <CoverageRow
              name="NSW Court of Appeal"
              status="This month"
              tone="soon"
            />
            <CoverageRow
              name="Federal Court of Australia"
              status="This month"
              tone="soon"
            />
            <CoverageRow
              name="High Court of Australia"
              status="This month"
              tone="soon"
            />
            <CoverageRow
              name="VIC, QLD, WA, SA Supreme Courts"
              status="Q3"
              tone="planned"
            />
            <CoverageRow
              name="Tribunals (NCAT, AAT, VCAT)"
              status="Q4"
              tone="planned"
            />
          </div>
          <div>
            <h3 className="bb-coverage-heading">Sourced direct, not scraped.</h3>
            <p className="bb-coverage-text">
              BriefBridge ingests judgments directly from court sources under
              their published republication policies. Every judgment is
              attributed, every source is linked, and suppression orders are
              honoured.
            </p>
            <p className="bb-coverage-text">
              The unofficial copies you read here always link back to the
              authoritative court version.
            </p>
          </div>
        </div>
      </section>

      {/* === CTA === */}
      <section className="bb-cta-strip" id="get-started">
        <div className="bb-cta-strip-inner">
          <h2>
            Join the lawyers <em>building the future</em> of Australian legal
            research.
          </h2>
          <p>
            BriefBridge is live and growing court by court. Sign in to start
            researching, or get in touch to shape what we build next.
          </p>
          <div className="bb-hero-cta">
            {isLoggedIn ? (
              <Link
                href="/matters"
                className="bb-btn bb-btn-primary bb-btn-large"
              >
                Go to app →
              </Link>
            ) : (
              <Link
                href="/login"
                className="bb-btn bb-btn-primary bb-btn-large"
              >
                Sign in →
              </Link>
            )}
            <a
              href="mailto:osr9915@gmail.com"
              className="bb-btn bb-btn-ghost bb-btn-large"
            >
              Talk to us
            </a>
          </div>
        </div>
      </section>

      {/* === FOOTER === */}
      <footer className="bb-footer">
        <div className="bb-footer-inner">
          <div className="bb-footer-brand">
            <Link href="/" className="bb-brand" aria-label="BriefBridge">
              <Image
                src="/logo.png"
                alt="BriefBridge"
                width={180}
                height={42}
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
              <li><Link href="#how">How it works</Link></li>
              <li><Link href="#coverage">Coverage</Link></li>
              <li><Link href="/cases">Cases</Link></li>
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
              <li><Link href="#">Privacy</Link></li>
              <li><Link href="#">Terms</Link></li>
              <li><Link href="#">Source attribution</Link></li>
            </ul>
          </div>
        </div>
        <div className="bb-footer-bottom">
          <span>© 2026 BriefBridge. All rights reserved.</span>
          <span>Made in Australia 🇦🇺</span>
        </div>
      </footer>
    </>
  );
}

function CoverageRow({
  name,
  status,
  tone,
}: {
  name: string;
  status: string;
  tone: 'live' | 'soon' | 'planned';
}) {
  return (
    <div className="bb-coverage-item">
      <span className="bb-coverage-name">{name}</span>
      <span className="bb-coverage-status">
        <span className={`bb-coverage-dot bb-dot-${tone}`} />
        {status}
      </span>
    </div>
  );
}