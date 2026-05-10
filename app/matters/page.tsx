// app/matters/page.tsx
//
// Layout-only matter list. Uses MOCK_MATTERS until auth + database land.
// When that lands, replace MOCK_MATTERS with a real DB query and the rest
// of this file should not need to change.

import Link from 'next/link';
import { StickyHeader } from '../_components/sticky-header';
import { MOCK_MATTERS, type MockMatter } from './_data/mock-matters';

// =============================================================================
// Page
// =============================================================================

export default function MattersPage() {
  return (
    <>
      <StickyHeader />

      <main className="bb-matters-main">
        <header className="bb-matters-head">
          <div className="bb-section-eyebrow">Your workspace</div>
          <h1 className="bb-matters-title">
            Cases <em>and matters</em>
          </h1>
          <p className="bb-matters-sub">
            Each case keeps your research, files, and conversations in one
            place. Ask BriefBridge anything in context — your facts, your
            authorities.
          </p>
        </header>

        <section className="bb-matters-grid">
          <NewMatterCard />
          {MOCK_MATTERS.map((m) => (
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
    </>
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
        <StatusBadge status={matter.status} />
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

function StatusBadge({ status }: { status: MockMatter['status'] }) {
  const labels: Record<MockMatter['status'], string> = {
    active: 'Active',
    'on-hold': 'On hold',
    archived: 'Archived',
  };
  return (
    <span className={`bb-status-badge bb-status-${status}`}>
      <span className="bb-status-dot" />
      {labels[status]}
    </span>
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
