// app/(app)/matters/[id]/_components/matter-view.tsx
//
// The matter detail page view. Receives a real Matter from the server,
// adapts it for the existing MatterTabs component, and renders:
//   - An inline-editable header (name / client / description) — Chunk 4
//   - A sidebar with case details, glance stats, quick actions
//   - The tabbed workspace below
//
// What changed in Chunk 4:
//   - Name / Client / Description are now click-to-edit. Hover → subtle
//     warm-cream tint + pencil hint. Click → field becomes editable.
//     Blur → saves. Enter (on name/client) → commits. Escape → restores.
//   - If the URL has `?new=1`, the name input is auto-focused on mount
//     and the existing text is selected, so a freshly-created "Untitled
//     case" can be renamed immediately by typing. The `?new=1` is then
//     stripped from the URL so a refresh doesn't re-trigger the focus.
//   - The "Edit case details" Quick Action button now focuses the name
//     input (discoverability hint for users who haven't realised the
//     title is clickable).
//   - Optimistic updates flow through the MattersProvider's updateDetails
//     method, so changes propagate live to the sidebar case row and the
//     matters list page.
//
// What's still the same as Chunk 3:
//   - Consults MattersProvider for live state (status changes, edits)
//   - Adapts the real Matter into MockMatter shape for MatterTabs
//   - Quick action buttons (other than Edit) are still disabled stubs

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
import type { Matter, Conversation } from '@/lib/db/schema';
import type { InitialMessage } from '../../../_components/streaming-chat';

// =============================================================================
// Length caps — kept in sync with the server action + DB query
// =============================================================================

const NAME_MAX = 200;
const CLIENT_MAX = 200;
const DESCRIPTION_MAX = 2000;

// =============================================================================
// MatterView
// =============================================================================

export function MatterView({
  matter: serverMatter,
  matterConversations,
  activeConversation,
}: {
  matter: Matter;
  matterConversations: Conversation[];
  activeConversation: {
    conversation: Conversation;
    messages: InitialMessage[];
  } | null;
}) {
  // Prefer the provider's copy of this matter so status changes AND inline
  // edits (made anywhere in the app) reflect immediately. Fall back to the
  // server-fetched matter if the provider hasn't initialised yet.
  const { findMatter, updateDetails } = useMatters();
  const liveMatter = findMatter(serverMatter.id) ?? serverMatter;

  // The name input — referenced from the auto-focus effect AND from the
  // "Edit case details" Quick Action button.
  const nameInputRef = useRef<HTMLInputElement | null>(null);

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
    // Defer to next frame so the input is mounted and visible.
    const handle = requestAnimationFrame(() => {
      const input = nameInputRef.current;
      if (input) {
        input.focus();
        input.select();
      }
      // Strip the ?new=1 from the URL without triggering a navigation.
      // router.replace with `scroll: false` preserves scroll position and
      // avoids any visual jolt.
      const url = new URL(window.location.href);
      url.searchParams.delete('new');
      router.replace(url.pathname + url.search, { scroll: false });
    });
    return () => cancelAnimationFrame(handle);
    // Only run on mount — `isNew` derived from initial searchParams.
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
          />
        </div>

        {/* Sidebar — metadata, sticky on desktop */}
        <aside className="bb-matter-sidebar">
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
                <span>0</span> Files
              </li>
              <li>
                <span>{matterConversations.length}</span> Research sessions
              </li>
              <li>
                <span>0</span> Authorities cited
              </li>
            </ul>
          </div>

          <div className="bb-matter-sidebar-card">
            <h3 className="bb-matter-sidebar-heading">Quick actions</h3>
            <div className="bb-matter-sidebar-actions">
              <button type="button" className="bb-matter-sidebar-action" disabled>
                + Upload file
              </button>
              <button
                type="button"
                className="bb-matter-sidebar-action"
                onClick={() => router.push(`/matters/${liveMatter.id}?compose=1`)}
              >
                + New research
              </button>
              {/* Wired to focus the name input — discoverability hint */}
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

  // Keep local state synced when the server value changes from elsewhere
  // (e.g. another tab made an edit). We only overwrite if the user isn't
  // actively focused on the input.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setValue(initialValue);
    }
  }, [initialValue, inputRef]);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    // Hard cap at NAME_MAX to give the user a clear stop point.
    const next = e.target.value.slice(0, NAME_MAX);
    setValue(next);
  }

  async function handleBlur(_e: FocusEvent<HTMLInputElement>) {
    const trimmed = value.trim();

    // Silent snap-back on empty name. The user's intent was "make this
    // blank" but blank names aren't allowed; the kindest UX is to restore
    // the prior value without showing an error.
    if (trimmed.length === 0) {
      setValue(initialValue);
      return;
    }

    // Nothing changed — no-op.
    if (trimmed === initialValue) {
      // Normalise (user may have typed trailing spaces).
      if (trimmed !== value) setValue(trimmed);
      return;
    }

    setIsSaving(true);
    const result = await updateDetails(matterId, { name: trimmed });
    setIsSaving(false);

    if (!result.ok) {
      // Server rejected — provider has already rolled back its state, but
      // our local input still shows the bad value. Restore.
      setValue(initialValue);
    } else {
      // Success — make sure our local matches the server-normalised value.
      setValue(trimmed);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Blur fires handleBlur, which saves.
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // Restore the prior value and blur (without saving).
      setValue(initialValue);
      // Defer blur so the value reset has flushed first.
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
    // Empty becomes null (clears the field).
    const next = trimmed.length === 0 ? null : trimmed;
    const prev = initialValue;

    // No change — bail.
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

  // Auto-grow the textarea to fit content. We measure on every keystroke
  // AND on initial mount (in case the initial value is multi-line).
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
    // Enter inserts a newline (default behaviour — don't prevent).
    // Escape restores and blurs.
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

// Resizes a textarea to fit its content. Used by EditableDescription.
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
