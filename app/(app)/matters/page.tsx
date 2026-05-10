// app/(app)/matters/page.tsx
//
// Layout-only matter list. Reads from the MattersProvider context so
// status changes made via the StatusMenu component update the cards
// (and the sidebar's case icons) in real time.
//
// Why this is now a Client Component:
//   The matters list needs to read from React Context (MattersProvider)
//   so status changes propagate everywhere live. Server Components can't
//   subscribe to client context. Once auth + a real DB land, the matters
//   array will be seeded from a server query (passed as initial state to
//   the provider) — but the live editing UX still requires client state.
//
// Note: StickyHeader is no longer rendered here. The (app) layout's sidebar
// provides navigation across all workspace pages.

'use client';

import Link from 'next/link';
import { useMatters } from './_components/matters-provider';
import { StatusMenu } from './_components/status-menu';
import type { MockMatter } from './_data/mock-matters';

// =============================================================================
// Page
// =============================================================================

export default function MattersPage() {
  const { matters } = useMatters();

  return (
    <main className="bb-matters-main">
      <header className="bb-matters-head">
        <div className="bb-section-eyebrow">Your workspace</div>
        <h1 className="bb-matters-title">
          Cases <em>and matters</em>
        </h1>
        <p className="bb-matters-sub">
          Each case keeps your research, files, and conversations in one place.
          Ask BriefBridge anything in context — your facts, your authorities.
        </p>
      </header>

      <section className="bb-matters-grid">
        <NewMatterCard />
        {matters.map((m) => (
          <MatterCard key={m.id} matter={m} />
        ))}
      </section>

      <div className="bb-matters-mock-banner">
        <span>Preview UI</span>
        <p>
          These cases are placeholder examples. Authentication and persistent
          storage are coming soon — once those land, your real cases will
          appear here.
        </p>
      </div>
    </main>
  );
}

// =============================================================================
// Components
// =============================================================================

function MatterCard({ matter }: { matter: MockMatter }) {
  return (
    <Link href={`/matters/${matter.id}`} className="bb-matter-card">
      <div className="bb-matter-card-head">
        <div className="bb-matter-card-name-block">
          <h3 className="bb-matter-card-name">{matter.name}</h3>
          <p className="bb-matter-card-client">{matter.client}</p>
        </div>
        <StatusMenu matterId={matter.id} size="card" />
      </div>

      <p className="bb-matter-card-desc">{matter.description}</p>

      <div className="bb-matter-card-recent">
        <span className="bb-matter-card-recent-dot" />
        <span>{matter.recentActivity}</span>
      </div>

      <div className="bb-matter-card-stats">
        <Stat label="Files" value={matter.fileCount} />
        <Stat label="Conversations" value={matter.conversationCount} />
        <Stat label="Authorities" value={matter.citedAuthorities} />
        <span className="bb-matter-card-time">{matter.lastActivity}</span>
      </div>
    </Link>
  );
}

function NewMatterCard() {
  return (
    <button type="button" className="bb-matter-new" aria-label="Create new case">
      <div className="bb-matter-new-icon">+</div>
      <div className="bb-matter-new-title">New case</div>
      <div className="bb-matter-new-sub">
        Start a workspace for a client matter
      </div>
    </button>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="bb-matter-stat">
      <span className="bb-matter-stat-value">{value}</span>
      <span className="bb-matter-stat-label">{label}</span>
    </span>
  );
}
