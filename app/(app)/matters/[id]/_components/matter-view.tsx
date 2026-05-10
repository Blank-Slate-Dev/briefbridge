// app/(app)/matters/[id]/_components/matter-view.tsx
//
// Client view for the single-matter workspace. Reads the matter from the
// MattersProvider context so status changes (via StatusMenu in the header)
// propagate to the sidebar and the matters list immediately.

'use client';

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { useMatters } from '../../_components/matters-provider';
import { StatusMenu } from '../../_components/status-menu';
import { STATUS_LABELS, type MatterStatus } from '../../_data/mock-matters';
import { MatterTabs } from './matter-tabs';

export function MatterView({ id }: { id: string }) {
  const { findMatter } = useMatters();
  const matter = findMatter(id);

  // Triggers the not-found.tsx (or default Next 404) for unknown ids.
  // notFound() throws, so the rest of the component doesn't run.
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
              <StatusMenu matterId={matter.id} size="header" />
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

function renderStatus(status: MatterStatus): string {
  return STATUS_LABELS[status];
}
