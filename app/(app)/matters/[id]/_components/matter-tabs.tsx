// app/(app)/matters/[id]/_components/matter-tabs.tsx
//
// Tabbed view inside a matter workspace.
//
// What changed in Chunk 5:
//   - "Chat" tab and "Conversations" tab merged into a single "Research" tab.
//     Rationale: under the BriefBridge vocabulary, "Research" is the
//     lawyer↔AI feature and "Conversations" is reserved for the future
//     lawyer↔lawyer collaboration feature. The old "Conversations" tab
//     was an empty placeholder gesturing at something we hadn't built.
//   - Count badges hidden when 0. Same rule applied to Files and Authorities
//     for consistency (matches Notes which never had one).
//   - The Research tab pulls real DB data via props (conversations +
//     activeConversation) instead of the old MockMatter.conversations.
//
// Tab order: Research · Files · Authorities · Notes

'use client';

import { useState } from 'react';
import type { Conversation } from '@/lib/db/schema';
import type { MockMatter } from '../../_data/mock-matters';
import { MatterResearchTab } from './matter-research-tab';
import type { InitialMessage } from '../../../_components/streaming-chat';

type TabKey = 'research' | 'files' | 'authorities' | 'notes';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'research', label: 'Research' },
  { key: 'files', label: 'Files' },
  { key: 'authorities', label: 'Authorities' },
  { key: 'notes', label: 'Notes' },
];

export interface MatterTabsProps {
  /** Adapter view-model for Files/Authorities/Notes (still mock data). */
  matter: MockMatter;
  /** Real matter id, for the Research tab. */
  matterId: string;
  /** Real matter name (Adapter's `matter.name` would also work). */
  matterName: string;
  /** Past in-matter conversations from the DB. */
  conversations: Conversation[];
  /** Currently-active conversation (URL ?conversationId=X resolved server-side). */
  activeConversation: {
    conversation: Conversation;
    messages: InitialMessage[];
  } | null;
}

export function MatterTabs({
  matter,
  matterId,
  matterName,
  conversations,
  activeConversation,
}: MatterTabsProps) {
  // If there's an active conversation OR a ?compose=1 in the URL, start on
  // the Research tab. Otherwise default to Research anyway — it's the most
  // useful entry point.
  const [active, setActive] = useState<TabKey>('research');

  // Count badge logic: hide entirely when the count is 0. When non-zero,
  // show as a small pill next to the tab label. Same rule for all tabs
  // that have counts; Notes never has one.
  const counts: Record<TabKey, number | null> = {
    research: conversations.length,
    files: matter.files.length,
    authorities: matter.authorities.length,
    notes: null,
  };

  return (
    <div className="bb-matter-tabs">
      <nav
        className="bb-matter-tablist"
        role="tablist"
        aria-label="Case sections"
      >
        {TABS.map((tab) => {
          const count = counts[tab.key];
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active === tab.key}
              className={`bb-matter-tab ${
                active === tab.key ? 'bb-matter-tab-active' : ''
              }`}
              onClick={() => setActive(tab.key)}
            >
              {tab.label}
              {count !== null && count > 0 && (
                <span className="bb-matter-tab-count">{count}</span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="bb-matter-tabpanel" role="tabpanel">
        {active === 'research' && (
          <MatterResearchTab
            matterId={matterId}
            matterName={matterName}
            conversations={conversations}
            activeConversation={activeConversation}
            fileCount={matter.files.length}
            authorityCount={matter.authorities.length}
          />
        )}
        {active === 'files' && <FilesTab matter={matter} />}
        {active === 'authorities' && <AuthoritiesTab matter={matter} />}
        {active === 'notes' && <NotesTab matter={matter} />}
      </div>
    </div>
  );
}

// =============================================================================
// Files tab (unchanged from Chunk 2 — still mock data until Chunk 6)
// =============================================================================

function FilesTab({ matter }: { matter: MockMatter }) {
  return (
    <div className="bb-matter-files">
      <div className="bb-matter-section-head">
        <div>
          <h2>Files</h2>
          <p>Upload pleadings, evidence, advices, and correspondence.</p>
        </div>
        <button type="button" className="bb-btn bb-btn-primary" disabled>
          + Upload file
        </button>
      </div>

      {matter.files.length === 0 ? (
        <div className="bb-matter-empty">
          <h3>No files yet</h3>
          <p>Add the first document to this case to get started.</p>
        </div>
      ) : (
        <ul className="bb-matter-file-list">
          {matter.files.map((f) => (
            <li key={f.id} className="bb-matter-file">
              <div className="bb-matter-file-icon" aria-hidden>
                {fileGlyph(f.name)}
              </div>
              <div className="bb-matter-file-body">
                <div className="bb-matter-file-name">{f.name}</div>
                <div className="bb-matter-file-meta">
                  <span className="bb-matter-file-cat">{f.category}</span>
                  <span>{f.size}</span>
                  <span>Uploaded {f.uploadedAt}</span>
                </div>
              </div>
              <button
                type="button"
                className="bb-matter-file-action"
                aria-label="More actions"
              >
                ⋯
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function fileGlyph(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'PDF';
  if (ext === 'docx' || ext === 'doc') return 'DOC';
  if (ext === 'xlsx' || ext === 'xls') return 'XLS';
  if (ext === 'pptx' || ext === 'ppt') return 'PPT';
  return 'FILE';
}

// =============================================================================
// Authorities tab (unchanged from Chunk 2)
// =============================================================================

function AuthoritiesTab({ matter }: { matter: MockMatter }) {
  return (
    <div className="bb-matter-authorities">
      <div className="bb-matter-section-head">
        <div>
          <h2>Cited authorities</h2>
          <p>
            Cases and legislation surfaced across this matter&apos;s research,
            ranked by frequency.
          </p>
        </div>
      </div>

      {matter.authorities.length === 0 ? (
        <div className="bb-matter-empty">
          <h3>No authorities cited yet</h3>
          <p>
            As you research within this case, BriefBridge will track every
            authority you rely on.
          </p>
        </div>
      ) : (
        <ul className="bb-matter-auth-list">
          {matter.authorities.map((a, i) => (
            <li key={i} className="bb-matter-auth">
              <div className="bb-matter-auth-rank">{i + 1}</div>
              <div className="bb-matter-auth-body">
                <div className="bb-matter-auth-head">
                  <h3 className="bb-matter-auth-name">{a.name}</h3>
                  <span className="bb-matter-auth-cite">{a.citation}</span>
                </div>
                <p className="bb-matter-auth-prop">{a.proposition}</p>
              </div>
              <div className="bb-matter-auth-stat">
                <span>{a.citedTimes}×</span>
                <span>cited</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// =============================================================================
// Notes tab (unchanged from Chunk 2)
// =============================================================================

function NotesTab({ matter }: { matter: MockMatter }) {
  return (
    <div className="bb-matter-notes">
      <div className="bb-matter-section-head">
        <div>
          <h2>Notes</h2>
          <p>Free-form working notes for this matter.</p>
        </div>
        <button type="button" className="bb-btn bb-btn-ghost" disabled>
          Edit
        </button>
      </div>

      {matter.notes ? (
        <div className="bb-matter-note-body">
          <p>{matter.notes}</p>
        </div>
      ) : (
        <div className="bb-matter-empty">
          <h3>No notes yet</h3>
          <p>Add working notes, instructions, or strategy reminders here.</p>
        </div>
      )}
    </div>
  );
}
