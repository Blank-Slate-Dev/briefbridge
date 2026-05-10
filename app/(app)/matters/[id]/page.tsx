// app/(app)/matters/[id]/page.tsx
//
// Single-matter workspace. Two-column layout: tabbed main area + sticky right
// sidebar with metadata. Layout-only — uses MOCK_MATTERS for content.
//
// Note: StickyHeader is no longer rendered here. The (app) layout's sidebar
// provides navigation.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { findMockMatter, type MockMatter } from '../_data/mock-matters';
import { MatterTabs } from './_components/matter-tabs';

export default async function MatterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const matter = findMockMatter(id);

  if (!matter) {
    notFound();
  }

  return (
    <main className="bb-matter-main">
      <Link href="/matters" className="bb-matter-back">
        ← All cases
      </Link>

      <div className="bb-matter-layout">
        {/* Main column — title + tabs */}
        <div className="bb-matter-content">
          <header className="bb-matter-head">
            <div className="bb-matter-head-row">
              <div>
                <p className="bb-matter-client">{matter.client}</p>
                <h1 className="bb-matter-name">{matter.name}</h1>
              </div>
              <StatusBadge status={matter.status} />
            </div>
            <p className="bb-matter-desc">{matter.description}</p>
          </header>

          <MatterTabs matter={matter} />
        </div>

        {/* Sidebar — metadata, sticky on desktop */}
        <aside className="bb-matter-sidebar">
          <div className="bb-matter-sidebar-card">
            <h3 className="bb-matter-sidebar-heading">Case details</h3>
            <dl className="bb-matter-sidebar-fields">
              <Field label="Client" value={matter.client} />
              <Field label="Opened" value={matter.openedOn} />
              <Field label="Last activity" value={matter.lastActivity} />
              <Field label="Status" value={renderStatus(matter.status)} />
            </dl>
          </div>

          <div className="bb-matter-sidebar-card">
            <h3 className="bb-matter-sidebar-heading">At a glance</h3>
            <ul className="bb-matter-sidebar-stats">
              <li>
                <span>{matter.fileCount}</span> Files
              </li>
              <li>
                <span>{matter.conversationCount}</span> Conversations
              </li>
              <li>
                <span>{matter.citedAuthorities}</span> Authorities cited
              </li>
            </ul>
          </div>

          <div className="bb-matter-sidebar-card">
            <h3 className="bb-matter-sidebar-heading">Quick actions</h3>
            <div className="bb-matter-sidebar-actions">
              <button type="button" className="bb-matter-sidebar-action">
                + Upload file
              </button>
              <button type="button" className="bb-matter-sidebar-action">
                + New conversation
              </button>
              <button type="button" className="bb-matter-sidebar-action">
                Edit case details
              </button>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="bb-matter-field">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
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

function renderStatus(status: MockMatter['status']): string {
  switch (status) {
    case 'active':
      return 'Active';
    case 'on-hold':
      return 'On hold';
    case 'archived':
      return 'Archived';
  }
}
