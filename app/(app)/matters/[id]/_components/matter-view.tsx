// app/(app)/matters/[id]/_components/matter-view.tsx
//
// The matter detail page view. Receives a real Matter from the server,
// adapts it for the existing MatterTabs component, and renders:
//   - An inline-editable header (name / client / description) — Chunk 4
//   - A sidebar with case details, glance stats, quick actions
//   - The tabbed workspace below
//   - A collapse toggle for the right-hand sidebar (NEW): slides the
//     Case Details column out to the right and lets the content widen to
//     fill. State persists across visits via localStorage.
//
// What changed in Chunk 6:
//   - Accepts `initialFiles` (with tags pre-joined) and `personalTagHistory`
//     from the server-side page fetch
//   - Wraps everything inside <FilesProvider> so both the Files tab AND the
//     sidebar's "At a glance" + quota indicator see the same files state
//   - The "0 Files" stat in "At a glance" is now live — derived from the
//     provider via <FilesStatLive />
//   - The compact <QuotaIndicator variant="compact" /> renders inside the
//     "At a glance" card, below the existing stats list
//   - Threads `matterId`, `initialFiles`, and `personalTagHistory` through
//     to MatterTabs so the Files tab can wire them into FilesTab
//   - Sidebar's "+ Upload file" quick-action button stays disabled. The
//     real upload affordance lives inside the Files tab (+ Upload files
//     button + drag-anywhere drop zone). A future refactor could lift
//     MatterTabs' activeTab state up here and have the sidebar button
//     switch to the Files tab, but that's not scope for Chunk 6.
//
// What changed in Chunk 4 (unchanged in Chunk 6):
//   - Name / Client / Description are click-to-edit
//   - ?new=1 URL param auto-focuses the name input
//   - "Edit case details" Quick Action focuses the name input

'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';
import { useMatters } from '../../_components/matters-provider';
import { StatusMenu } from '../../_components/status-menu';
import {
  STATUS_LABELS,
  type MatterStatus,
  type MockMatter,
} from '../../_data/mock-matters';
import { MatterTabs } from './matter-tabs';
import { FilesProvider, useFiles } from './files-provider';
import { QuotaIndicator } from './quota-indicator';
import type { Matter, Conversation } from '@/lib/db/schema';
import type { InitialMessage } from '../../../_components/streaming-chat';
import type { FileWithTags } from '@/lib/db/queries/files';

// =============================================================================
// Length caps — kept in sync with the server action + DB query
// =============================================================================

const NAME_MAX = 200;
const CLIENT_MAX = 200;
const DESCRIPTION_MAX = 2000;

// localStorage key for the sidebar collapsed state. Scoped to this feature
// so it can't collide with anything else stored by the app.
const SIDEBAR_COLLAPSED_KEY = 'bb:matter-sidebar-collapsed';

// =============================================================================
// MatterView
// =============================================================================

export function MatterView({
  matter: serverMatter,
  matterConversations,
  activeConversation,
  initialFiles,
  personalTagHistory,
}: {
  matter: Matter;
  matterConversations: Conversation[];
  activeConversation: {
    conversation: Conversation;
    messages: InitialMessage[];
  } | null;
  initialFiles: FileWithTags[];
  personalTagHistory: string[];
}) {
  // Prefer the provider's copy of this matter so status changes AND inline
  // edits (made anywhere in the app) reflect immediately. Fall back to the
  // server-fetched matter if the provider hasn't initialised yet.
  const { findMatter, updateDetails } = useMatters();
  const liveMatter = findMatter(serverMatter.id) ?? serverMatter;

  // The name input — referenced from the auto-focus effect AND from the
  // "Edit case details" Quick Action button.
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  // ---- Sidebar collapse state ---------------------------------------------
  // We seed `false` (expanded) for the server render and the very first
  // client render so SSR and hydration agree — reading localStorage during
  // render would cause a hydration mismatch. After mount, an effect reads the
  // stored preference and applies it. The CSS transition only kicks in on
  // user toggles, not on this initial sync (see `hasMounted` gate below).
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
      if (stored === '1') setSidebarCollapsed(true);
    } catch {
      // localStorage can throw in private-mode / blocked-cookie scenarios.
      // Failing to read the preference is harmless — we just default open.
    }
    setHasMounted(true);
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      } catch {
        // Persisting is best-effort; ignore storage failures.
      }
      return next;
    });
  }, []);

  // ?new=1 auto-focus on mount ----------------------------------------------
  // When a brand-new matter is created, the user lands here with `?new=1`
  // in the URL. We focus the name input and select its content so they can
  // immediately start typing to rename the placeholder "Untitled case".
  // Then we strip the param so refresh doesn't repeat the focus.
  const router = useRouter();
  const searchParams = useSearchParams();
  const isNew = searchParams.get('new') === '1';
  useEffect(() => {
    if (!isNew) return;
    const handle = requestAnimationFrame(() => {
      const input = nameInputRef.current;
      if (input) {
        input.focus();
        input.select();
      }
      const url = new URL(window.location.href);
      url.searchParams.delete('new');
      router.replace(url.pathname + url.search, { scroll: false });
    });
    return () => cancelAnimationFrame(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus the name input — used by the "Edit case details" Quick Action.
  const focusNameInput = useCallback(() => {
    const input = nameInputRef.current;
    if (input) {
      input.focus();
      input.select();
    }
  }, []);

  // Adapter — real Matter → MockMatter for the tabs.
  const adapted = adaptMatter(liveMatter);

  // Build the layout className. `--collapsed` shrinks the sidebar column to
  // zero and slides the panel out; `--ready` enables the CSS transition only
  // after the first mount so the localStorage sync doesn't animate on load.
  const layoutClass = [
    'bb-matter-layout',
    sidebarCollapsed ? 'bb-matter-layout--collapsed' : '',
    hasMounted ? 'bb-matter-layout--ready' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <FilesProvider matterId={liveMatter.id} initialFiles={initialFiles}>
      <main className="bb-matter-main">
        <div className="bb-matter-topbar">
          <Link href="/matters" className="bb-matter-back">
            ← All cases
          </Link>

          {/* Sidebar toggle. Label + arrow direction reflect current state.
              Lives in the top bar so it's always visible even when the
              panel itself has slid away. */}
          <button
            type="button"
            className="bb-matter-sidebar-toggle"
            onClick={toggleSidebar}
            aria-expanded={!sidebarCollapsed}
            aria-controls="bb-matter-sidebar"
          >
            {sidebarCollapsed ? (
              <>
                <span className="bb-matter-sidebar-toggle-arrow" aria-hidden>
                  ‹
                </span>
                Show details
              </>
            ) : (
              <>
                Hide details
                <span className="bb-matter-sidebar-toggle-arrow" aria-hidden>
                  ›
                </span>
              </>
            )}
          </button>
        </div>

        <div className={layoutClass}>
          {/* Main column — title + tabs */}
          <div className="bb-matter-content">
            <header className="bb-matter-head">
              <div className="bb-matter-head-row">
                <div className="bb-matter-head-text">
                  <EditableClient
                    initialValue={liveMatter.client}
                    matterId={liveMatter.id}
                    updateDetails={updateDetails}
                  />
                  <EditableName
                    initialValue={liveMatter.name}
                    matterId={liveMatter.id}
                    updateDetails={updateDetails}
                    inputRef={nameInputRef}
                  />
                </div>
                <StatusMenu matterId={liveMatter.id} size="header" />
              </div>
              <EditableDescription
                initialValue={liveMatter.description}
                matterId={liveMatter.id}
                updateDetails={updateDetails}
              />
            </header>

            <MatterTabs
              matter={adapted}
              matterId={liveMatter.id}
              matterName={liveMatter.name}
              conversations={matterConversations}
              activeConversation={activeConversation}
              personalTagHistory={personalTagHistory}
            />
          </div>

          {/* Sidebar — metadata, sticky on desktop. Slides out when collapsed.
              aria-hidden when collapsed so screen readers skip the offscreen
              panel; the toggle button remains the way back in. */}
          <aside
            id="bb-matter-sidebar"
            className="bb-matter-sidebar"
            aria-hidden={sidebarCollapsed}
          >
            <div className="bb-matter-sidebar-card">
              <h3 className="bb-matter-sidebar-heading">Case details</h3>
              <dl className="bb-matter-sidebar-fields">
                {liveMatter.client && (
                  <Field label="Client" value={liveMatter.client} />
                )}
                <Field label="Opened" value={formatDate(liveMatter.createdAt)} />
                <Field
                  label="Last activity"
                  value={formatRelative(liveMatter.updatedAt)}
                />
                <Field
                  label="Status"
                  value={STATUS_LABELS[liveMatter.status as MatterStatus]}
                />
              </dl>
            </div>

            <div className="bb-matter-sidebar-card">
              <h3 className="bb-matter-sidebar-heading">At a glance</h3>
              <ul className="bb-matter-sidebar-stats">
                <li>
                  <FilesStatLive />
                </li>
                <li>
                  <span>{matterConversations.length}</span> Research sessions
                </li>
                <li>
                  <span>0</span> Authorities cited
                </li>
              </ul>
              {/* Compact storage indicator — must live inside FilesProvider */}
              <div className="bb-matter-sidebar-quota">
                <QuotaIndicator variant="compact" />
              </div>
            </div>

            <div className="bb-matter-sidebar-card">
              <h3 className="bb-matter-sidebar-heading">Quick actions</h3>
              <div className="bb-matter-sidebar-actions">
                {/*
                  Disabled for now. Real upload affordance is inside the
                  Files tab (+ Upload files + drag-anywhere drop zone).
                  Wiring this to switch tabs would require lifting
                  MatterTabs' activeTab state up to this component, which
                  is a bigger refactor than Chunk 6 wants to take on.
                */}
                <button
                  type="button"
                  className="bb-matter-sidebar-action"
                  disabled
                >
                  + Upload file
                </button>
                <button
                  type="button"
                  className="bb-matter-sidebar-action"
                  onClick={() => router.push(`/matters/${liveMatter.id}?compose=1`)}
                >
                  + New research
                </button>
                <button
                  type="button"
                  className="bb-matter-sidebar-action"
                  onClick={focusNameInput}
                >
                  Edit case details
                </button>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </FilesProvider>
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

// =============================================================================
// FilesStatLive — small consumer of FilesProvider for the sidebar stat row
// =============================================================================
//
// Reads the live file count from FilesProvider so the "At a glance" Files
// stat updates instantly on upload/delete. Must be rendered inside the
// provider (which all sidebar content is, by virtue of MatterView wrapping
// everything in FilesProvider).

function FilesStatLive() {
  const { files } = useFiles();
  return (
    <>
      <span>{files.length}</span> Files
    </>
  );
}

// =============================================================================
// Editable field components
// =============================================================================
//
// All three share the same skeleton:
//   1. Local state mirrors the prop, debounced to the prop on the server's
//      authoritative value (which arrives via the live provider copy).
//   2. onBlur saves if the value has changed AND passes local validation.
//   3. Escape restores the local state to the prop and blurs.
//   4. The "saving" state shows a subtle opacity drop on the field.
//
// What differs between them:
//   - Validation rules (name required vs client/description optional)
//   - Element type (input vs textarea)
//   - Keyboard handling (Enter blurs on name/client, inserts newline on
//     description)

// -----------------------------------------------------------------------------
// EditableName
// -----------------------------------------------------------------------------

interface EditableNameProps {
  initialValue: string;
  matterId: string;
  updateDetails: (
    id: string,
    fields: { name?: string },
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

function EditableName({
  initialValue,
  matterId,
  updateDetails,
  inputRef,
}: EditableNameProps) {
  const [value, setValue] = useState(initialValue);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setValue(initialValue);
    }
  }, [initialValue, inputRef]);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const next = e.target.value.slice(0, NAME_MAX);
    setValue(next);
  }

  async function handleBlur(_e: FocusEvent<HTMLInputElement>) {
    const trimmed = value.trim();

    if (trimmed.length === 0) {
      setValue(initialValue);
      return;
    }

    if (trimmed === initialValue) {
      if (trimmed !== value) setValue(trimmed);
      return;
    }

    setIsSaving(true);
    const result = await updateDetails(matterId, { name: trimmed });
    setIsSaving(false);

    if (!result.ok) {
      setValue(initialValue);
    } else {
      setValue(trimmed);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setValue(initialValue);
      requestAnimationFrame(() => inputRef.current?.blur());
    }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      className={`bb-matter-editable bb-matter-editable-name ${
        isSaving ? 'bb-matter-editable-saving' : ''
      }`}
      value={value}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      placeholder="Case name"
      aria-label="Case name"
      maxLength={NAME_MAX}
      spellCheck={false}
    />
  );
}

// -----------------------------------------------------------------------------
// EditableClient
// -----------------------------------------------------------------------------

interface EditableClientProps {
  initialValue: string | null;
  matterId: string;
  updateDetails: (
    id: string,
    fields: { client?: string | null },
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}

function EditableClient({
  initialValue,
  matterId,
  updateDetails,
}: EditableClientProps) {
  const [value, setValue] = useState(initialValue ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (document.activeElement !== ref.current) {
      setValue(initialValue ?? '');
    }
  }, [initialValue]);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    setValue(e.target.value.slice(0, CLIENT_MAX));
  }

  async function handleBlur() {
    const trimmed = value.trim();
    const next = trimmed.length === 0 ? null : trimmed;
    const prev = initialValue;

    if (next === prev) {
      if (trimmed !== value) setValue(trimmed);
      return;
    }

    setIsSaving(true);
    const result = await updateDetails(matterId, { client: next });
    setIsSaving(false);

    if (!result.ok) {
      setValue(initialValue ?? '');
    } else {
      setValue(next ?? '');
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      ref.current?.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setValue(initialValue ?? '');
      requestAnimationFrame(() => ref.current?.blur());
    }
  }

  return (
    <input
      ref={ref}
      type="text"
      className={`bb-matter-editable bb-matter-editable-client ${
        isSaving ? 'bb-matter-editable-saving' : ''
      }`}
      value={value}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      placeholder="Add client name…"
      aria-label="Client name"
      maxLength={CLIENT_MAX}
      spellCheck={false}
    />
  );
}

// -----------------------------------------------------------------------------
// EditableDescription
// -----------------------------------------------------------------------------

interface EditableDescriptionProps {
  initialValue: string | null;
  matterId: string;
  updateDetails: (
    id: string,
    fields: { description?: string | null },
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}

function EditableDescription({
  initialValue,
  matterId,
  updateDetails,
}: EditableDescriptionProps) {
  const [value, setValue] = useState(initialValue ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (document.activeElement !== ref.current) {
      setValue(initialValue ?? '');
    }
  }, [initialValue]);

  useEffect(() => {
    autosize(ref.current);
  }, [value]);

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    setValue(e.target.value.slice(0, DESCRIPTION_MAX));
  }

  async function handleBlur() {
    const trimmed = value.trim();
    const next = trimmed.length === 0 ? null : trimmed;
    const prev = initialValue;

    if (next === prev) {
      if (trimmed !== value) setValue(trimmed);
      return;
    }

    setIsSaving(true);
    const result = await updateDetails(matterId, { description: next });
    setIsSaving(false);

    if (!result.ok) {
      setValue(initialValue ?? '');
    } else {
      setValue(next ?? '');
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      setValue(initialValue ?? '');
      requestAnimationFrame(() => ref.current?.blur());
    }
  }

  return (
    <textarea
      ref={ref}
      className={`bb-matter-editable bb-matter-editable-desc ${
        isSaving ? 'bb-matter-editable-saving' : ''
      }`}
      value={value}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      placeholder="Add a short description of this case…"
      aria-label="Case description"
      maxLength={DESCRIPTION_MAX}
      rows={1}
    />
  );
}

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

// =============================================================================
// Adapter: Matter (real DB row) → MockMatter (UI view-model)
// =============================================================================

function adaptMatter(m: Matter): MockMatter {
  return {
    id: m.id,
    name: m.name,
    client: m.client ?? '',
    description: m.description ?? '',
    status: m.status as MatterStatus,
    lastActivity: formatRelative(m.updatedAt),
    fileCount: 0,
    conversationCount: 0,
    citedAuthorities: 0,
    recentActivity: 'No recent activity',
    openedOn: formatDate(m.createdAt),
    overview: m.description ?? '',
    files: [],
    conversations: [],
    authorities: [],
    notes: m.notes ?? '',
  };
}

function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatRelative(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
  if (diffDay < 7) return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
  return formatDate(d);
}
