// app/(app)/matters/[id]/_components/matter-tabs.tsx
//
// Tabbed view inside a matter workspace.
//
// What changed in this pass (Research-tab navigation fix):
//   - The active tab was previously pure useState seeded to 'research',
//     fully disconnected from the URL. That caused a real bug: clicking
//     "+ New research" (→ ?compose=1) or opening a past conversation
//     (→ ?conversationId=X) changed the URL and re-fetched server data,
//     but if you weren't already looking at the Research tab — or even
//     sometimes when you were — the view didn't update, because `active`
//     state survived the navigation and React wasn't forced to reflect
//     the new conversation.
//   - Now: when the URL carries ?conversationId= or ?compose=1, the active
//     tab is FORCED to 'research'. We track whether the user has manually
//     picked a different tab AFTER the current URL state, so manual tab
//     switching still works, but any conversation/compose navigation
//     always lands on (and re-renders) the Research tab.
//   - The Research tab subtree is given a `key` derived from the URL's
//     conversation/compose state, so navigating between conversations (or
//     from a conversation to compose) cleanly remounts it with fresh data
//     instead of trying to reconcile stale internal state.
//
// What changed in Chunk 6:
//   - The internal FilesTab placeholder (mock data, disabled upload button)
//     has been REMOVED. The real FilesTab from ./files-tab is rendered
//     instead, with full upload/tag/delete functionality.
//   - Accepts `personalTagHistory: string[]` as a new prop, threaded down
//     to FilesTab for the tag editor autocomplete.
//   - The files count badge on the tab AND the fileCount prop passed to
//     MatterResearchTab are now LIVE — both come from useFiles() so they
//     reflect uploads and deletes instantly without a page refresh.
//
// What changed in Chunk 5 (unchanged since):
//   - "Chat" tab and "Conversations" tab merged into a single "Research" tab.
//   - Count badges hidden when 0.
//   - The Research tab pulls real DB data via props (conversations +
//     activeConversation) instead of the old MockMatter.conversations.
//
// Tab order: Research · Files · Authorities · Notes

'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Conversation } from '@/lib/db/schema';
import type { MockMatter } from '../../_data/mock-matters';
import { MatterResearchTab } from './matter-research-tab';
import { FilesTab } from './files-tab';
import { useFiles } from './files-provider';
import type { InitialMessage } from '../../../_components/streaming-chat';

type TabKey = 'research' | 'files' | 'authorities' | 'notes';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'research', label: 'Research' },
  { key: 'files', label: 'Files' },
  { key: 'authorities', label: 'Authorities' },
  { key: 'notes', label: 'Notes' },
];

export interface MatterTabsProps {
  /** Adapter view-model for Authorities/Notes (still mock data). */
  matter: MockMatter;
  /** Real matter id, for the Research and Files tabs. */
  matterId: string;
  /** Real matter name. */
  matterName: string;
  /** Past in-matter conversations from the DB. */
  conversations: Conversation[];
  /** Currently-active conversation (URL ?conversationId=X resolved server-side). */
  activeConversation: {
    conversation: Conversation;
    messages: InitialMessage[];
  } | null;
  /** This user's previously-used tag labels, for the tag editor autocomplete. */
  personalTagHistory: string[];
}

export function MatterTabs({
  matter,
  matterId,
  matterName,
  conversations,
  activeConversation,
  personalTagHistory,
}: MatterTabsProps) {
  const searchParams = useSearchParams();
  const conversationId = searchParams.get('conversationId');
  const isComposing = searchParams.get('compose') === '1';

  // A URL that carries a conversation id or compose flag means the user is
  // doing research — the Research tab MUST be visible and reflect it.
  const urlForcesResearch = Boolean(conversationId) || isComposing;

  // We keep an explicit "user manually selected a tab" state, but reset it
  // whenever the research-related URL changes, so a new conversation/compose
  // navigation always wins over a previously-clicked Files/Authorities tab.
  const [manualTab, setManualTab] = useState<TabKey | null>(null);

  // Signature of the current research URL state. When it changes, we clear
  // any manual tab override (so the new navigation lands on Research) and
  // use it as the remount key for the Research subtree.
  const researchKey = `${conversationId ?? ''}|${isComposing ? 'compose' : ''}`;
  const prevResearchKey = useRef(researchKey);
  useEffect(() => {
    if (prevResearchKey.current !== researchKey) {
      prevResearchKey.current = researchKey;
      if (urlForcesResearch) {
        // New conversation/compose navigation — drop any manual tab choice
        // so the Research tab becomes active and re-renders.
        setManualTab(null);
      }
    }
  }, [researchKey, urlForcesResearch]);

  // Resolve the active tab:
  //   - If the URL forces research AND the user hasn't manually navigated
  //     away since this URL state, show Research.
  //   - Otherwise honour the manual choice, defaulting to Research.
  const active: TabKey =
    urlForcesResearch && manualTab === null ? 'research' : manualTab ?? 'research';

  const selectTab = (key: TabKey) => setManualTab(key);

  // Live file count from the FilesProvider (which wraps MatterView, so
  // we're inside its scope here). Used for both the tab count badge and
  // the fileCount prop on the Research tab.
  const { files } = useFiles();
  const liveFileCount = files.length;

  // Count badge logic: hide entirely when the count is 0. When non-zero,
  // show as a small pill next to the tab label. Same rule for all tabs
  // that have counts; Notes never has one.
  const counts: Record<TabKey, number | null> = {
    research: conversations.length,
    files: liveFileCount,
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
              onClick={() => selectTab(tab.key)}
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
            // Remount on conversation/compose change so the Research tab
            // always reflects the URL rather than reconciling stale state.
            key={researchKey}
            matterId={matterId}
            matterName={matterName}
            conversations={conversations}
            activeConversation={activeConversation}
            fileCount={liveFileCount}
            authorityCount={matter.authorities.length}
          />
        )}
        {active === 'files' && (
          <FilesTab
            matterId={matterId}
            personalTagHistory={personalTagHistory}
          />
        )}
        {active === 'authorities' && <AuthoritiesTab matter={matter} />}
        {active === 'notes' && <NotesTab matter={matter} />}
      </div>
    </div>
  );
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
