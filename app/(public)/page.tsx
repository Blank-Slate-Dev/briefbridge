// app/(public)/page.tsx
//
// Homepage CONTENT only — the sticky header and footer now come from
// app/(public)/layout.tsx, shared with every public page.
import Link from 'next/link';
import { HeroPreview } from '../_components/hero-preview';
import { PricingSection } from '../_components/pricing-section';
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

  return (
    <>
      {/* === HERO === */}
      <section className="bb-hero">
        <div className="bb-hero-eyebrow">
          NSW Supreme Court, Court of Appeal, CCA and the High Court
        </div>
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
          <Link href="/login" className="bb-btn bb-btn-primary bb-btn-large">
            Sign in →
          </Link>
          <Link href="/demo" className="bb-btn bb-btn-ghost bb-btn-large">
            See a real answer
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
              invented quotes. No hallucinated citations. When there is no
              authority on point, it says so instead of producing something
              plausible.
            </p>
          </div>
          <div className="bb-problem-card">
            <div className="bb-problem-num">iii.</div>
            <h3>Australian-first</h3>
            {/* CLAIM CHECK: this card previously listed Victoria, Queensland
                and the Federal Court, none of which are in the corpus. It now
                names only what is actually ingested. The coverage list below
                is the single place that states what is and isn't live. */}
            <p>
              NSW Supreme Court, Court of Appeal and Court of Criminal Appeal,
              the High Court, and every in-force NSW and Commonwealth Act.
              Built for Australian law — not retrofitted from a US-trained
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

      {/* === PRICING === */}
      {/* Placed after "how it works" so the number lands once the reader
          knows what it buys, and before "coverage" so the corpus depth reads
          as reassurance on the way to the CTA. Moving it is one line. */}
      <PricingSection />

      {/* === COVERAGE === */}
      <section className="bb-section" id="coverage">
        <div className="bb-section-eyebrow">Coverage</div>
        <h2 className="bb-section-title">
          NSW and the High Court, in full. <em>Australia next.</em>
        </h2>
        <p className="bb-section-sub">
          We&apos;re building court-by-court, with full text and structured
          metadata — every judgment attributed and linked back to the
          authoritative version.
        </p>
        <div className="bb-coverage">
          <div className="bb-coverage-list">
            {/* CLAIM CHECK: statuses below are taken from PRODUCT_ROADMAP.md
                (13 Jul 2026), which supersedes the older figures. The previous
                version of this list UNDERSTATED the corpus — it showed the
                Court of Appeal and the High Court as "this month" when both
                are ingested and embedded — and OVERSTATED the Federal Court,
                which has not been started. Confirm before each release. */}
            <CoverageRow
              name="NSW Supreme Court (1999–)"
              status="Live"
              tone="live"
            />
            <CoverageRow
              name="NSW Court of Appeal"
              status="Live"
              tone="live"
            />
            <CoverageRow
              name="NSW Court of Criminal Appeal"
              status="Live"
              tone="live"
            />
            <CoverageRow
              name="High Court of Australia (1998–)"
              status="Live"
              tone="live"
            />
            <CoverageRow
              name="Commonwealth Acts, in force"
              status="Live"
              tone="live"
            />
            <CoverageRow
              name="NSW Acts, in force"
              status="Live"
              tone="live"
            />
            <CoverageRow
              name="High Court archive (1903–1997)"
              status="Next"
              tone="soon"
            />
            <CoverageRow
              name="Federal Court of Australia"
              status="Next"
              tone="soon"
            />
            <CoverageRow
              name="VIC, QLD, WA, SA Supreme Courts"
              status="Planned"
              tone="planned"
            />
            <CoverageRow
              name="Tribunals (NCAT, AAT, VCAT)"
              status="Planned"
              tone="planned"
            />
          </div>
          <div>
            <h3 className="bb-coverage-heading">
              Attributed, linked, and checkable.
            </h3>
            {/* CLAIM CHECK: the previous copy here said "direct ingestion with
                court permission". The High Court set is ingested via AustLII
                rather than from the Court, so that sentence was not one this
                audience could be asked to take on trust. Reworded to what is
                demonstrably true — republication policies, attribution,
                suppression orders — with no claim about permission. Restore a
                stronger claim only if you can point to the grant. */}
            <p className="bb-coverage-text">
              BriefBridge republishes judgments under the published
              republication policies that govern them. Every judgment is
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
            <Link
              href="/login"
              className="bb-btn bb-btn-primary bb-btn-large"
            >
              Sign in →
            </Link>
            <a
              href="mailto:oakley@briefbridge.ai"
              className="bb-btn bb-btn-ghost bb-btn-large"
            >
              Talk to us
            </a>
          </div>
        </div>
      </section>
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
