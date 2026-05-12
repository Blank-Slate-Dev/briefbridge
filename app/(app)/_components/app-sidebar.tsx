// app/(app)/_components/app-sidebar.tsx
//
// What changed in Chunk 5:
//   - PLACEHOLDER_RECENT_CHATS replaced with a `recentResearch` prop fetched
//     server-side by layout.tsx (real conversation rows from the DB).
//   - "New chat" button → "New research" (user-facing rename; "Research" is
//     the lawyer↔AI vocabulary; "Conversations" is reserved for future
//     lawyer↔lawyer collaboration).
//   - "Recent chats" section → "Recent research".
//   - Each recent-research item shows:
//       title (or "Untitled research" if null)
//       matter name · relative time   (if conversation has a matter_id)
//       relative time                 (if standalone /chat conversation)
//     Matter names are looked up from the existing `matters` prop via a
//     Map — no extra DB query needed.
//   - Click navigates to /matters/<matterId>?conversationId=X (in-matter) or
//     /chat?conversationId=X (standalone).
//
// What DIDN'T change:
//   - Mobile hamburger / drawer / backdrop logic
//   - Cases list rendering
//   - User button at the bottom
//   - All the focus-management and route-change effects

'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  ArrowRight,
  Briefcase,
  FilePlus,
  MessageSquare,
  PenSquare,
  Scale,
} from 'lucide-react';
import { useMatters } from '../matters/_components/matters-provider';
import type { MatterStatus } from '../matters/_data/mock-matters';
import type { Conversation } from '@/lib/db/schema';
import {
  SidebarUserButton,
  SidebarSignInButton,
} from './sidebar-user-button';

// =============================================================================
// Props
// =============================================================================

export interface AppSidebarProps {
  user: {
    email: string;
    displayName: string | null;
  } | null;
  /**
   * Recent conversations (research sessions) across all matters + standalone,
   * most-recently-updated first. Fetched server-side in layout.tsx via
   * listConversations(userId, { limit: 5 }).
   *
   * This data is server-fetched on each navigation. Conversations created
   * mid-session via SSE WON'T appear in the sidebar until next navigation.
   * Conscious tradeoff for Chunk 5 — see chunk handoff notes.
   */
  recentResearch: Conversation[];
}

// =============================================================================
// AppSidebar
// =============================================================================

export function AppSidebar({ user, recentResearch }: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { matters } = useMatters();

  // Build a Map<matterId, matterName> for fast lookup when rendering
  // recent-research items. The matters prop is already client-state from
  // MattersProvider, so this Map updates live when names change (Chunk 4
  // inline edits).
  const matterNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of matters) {
      map.set(m.id, m.name);
    }
    return map;
  }, [matters]);

  const [mobileOpen, setMobileOpen] = useState(false);
  const openedAtRef = useRef(0);

  function openDrawer(
    e?: ReactMouseEvent<HTMLButtonElement> | ReactPointerEvent<HTMLButtonElement>,
  ) {
    e?.preventDefault();
    e?.stopPropagation();
    openedAtRef.current = Date.now();
    setMobileOpen(true);
  }
  function closeDrawer() {
    if (Date.now() - openedAtRef.current < 400) return;
    setMobileOpen(false);
  }

  const sidebarRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      sidebarRef.current?.contains(active)
    ) {
      active.blur();
    }
  }, [pathname]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (mobileOpen) {
      const original = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = original;
      };
    }
  }, [mobileOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMobileOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const navId = useId();

  function handleNewResearch() {
    router.push('/chat');
    setMobileOpen(false);
  }

  return (
    <>
      <button
        type="button"
        className="bb-shell-hamburger"
        aria-label="Open navigation"
        aria-expanded={mobileOpen}
        aria-controls={navId}
        onPointerUp={openDrawer}
        onClick={openDrawer}
      >
        <span aria-hidden>☰</span>
      </button>

      <div
        className={`bb-shell-backdrop ${mobileOpen ? 'bb-shell-backdrop-open' : ''}`}
        onClick={closeDrawer}
        aria-hidden
      />

      <aside
        ref={sidebarRef}
        id={navId}
        className={`bb-shell-sidebar ${mobileOpen ? 'bb-shell-sidebar-mobile-open' : ''}`}
        aria-label="Workspace navigation"
      >
        <div className="bb-shell-brand">
          <Link href="/" className="bb-shell-brand-link" aria-label="BriefBridge home">
            <Image
              src="/logo.png"
              alt="BriefBridge"
              width={173}
              height={40}
              className="bb-shell-brand-logo"
              priority
            />
          </Link>
          <button
            type="button"
            className="bb-shell-mobile-close"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          >
            ✕
          </button>
        </div>

        <button
          type="button"
          className="bb-shell-new-chat"
          onClick={handleNewResearch}
          title="Start a new research session"
          aria-label="Start a new research session"
        >
          <span className="bb-shell-new-chat-icon" aria-hidden>
            <PenSquare size={16} strokeWidth={1.75} />
          </span>
          <span className="bb-shell-new-chat-label">New research</span>
        </button>

        <SidebarSection label="Recent research">
          <ul className="bb-shell-list">
            {recentResearch.length === 0 ? (
              <li className="bb-shell-list-empty">No recent research</li>
            ) : (
              recentResearch.map((c) => {
                const matterName =
                  c.matterId ? matterNameById.get(c.matterId) : null;
                const href = c.matterId
                  ? `/matters/${c.matterId}?conversationId=${c.id}`
                  : `/chat?conversationId=${c.id}`;
                const title = c.title ?? 'Untitled research';
                const time = formatRelative(c.updatedAt);
                const meta = matterName ? `${matterName} · ${time}` : time;
                return (
                  <li key={c.id}>
                    <Link href={href} className="bb-shell-list-item" title={title}>
                      <span className="bb-shell-list-item-icon" aria-hidden>
                        <MessageSquare size={16} strokeWidth={1.5} />
                      </span>
                      <span className="bb-shell-list-item-body">
                        <span className="bb-shell-list-item-title">
                          {title}
                        </span>
                        <span className="bb-shell-list-item-meta">{meta}</span>
                      </span>
                    </Link>
                  </li>
                );
              })
            )}
          </ul>
        </SidebarSection>

        <SidebarSection
          label="Cases"
          action={{
            icon: <FilePlus size={14} strokeWidth={1.75} />,
            href: '/matters',
            ariaLabel: 'View all cases',
          }}
        >
          <ul className="bb-shell-list">
            {matters.map((m) => {
              const active = pathname === `/matters/${m.id}`;
              return (
                <li key={m.id}>
                  <Link
                    href={`/matters/${m.id}`}
                    className={`bb-shell-list-item ${active ? 'bb-shell-list-item-active' : ''}`}
                    title={m.name}
                  >
                    <CaseIcon status={m.status} />
                    <span className="bb-shell-list-item-body">
                      <span className="bb-shell-list-item-title">{m.name}</span>
                      <span className="bb-shell-list-item-meta">
                        {m.client ?? ''}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <Link
            href="/matters"
            className="bb-shell-see-all"
            title="View all cases"
          >
            <span className="bb-shell-see-all-icon" aria-hidden>
              <ArrowRight size={14} strokeWidth={1.75} />
            </span>
            <span className="bb-shell-see-all-label">View all cases</span>
          </Link>
        </SidebarSection>

        <div className="bb-shell-bottom">
          <Link
            href="/cases"
            className="bb-shell-secondary-link"
            title="Search judgments"
          >
            <span className="bb-shell-secondary-icon" aria-hidden>
              <Scale size={16} strokeWidth={1.75} />
            </span>
            <span className="bb-shell-secondary-label">Judgments</span>
          </Link>

          {user ? (
            <SidebarUserButton
              email={user.email}
              displayName={user.displayName}
            />
          ) : (
            <SidebarSignInButton />
          )}
        </div>
      </aside>
    </>
  );
}

// =============================================================================
// CaseIcon — unchanged
// =============================================================================

function CaseIcon({ status }: { status: MatterStatus }) {
  return (
    <span className="bb-shell-list-item-icon bb-shell-case-icon" aria-hidden>
      <Briefcase size={16} strokeWidth={1.5} />
      <span
        className={`bb-shell-case-status-badge bb-shell-status-${status}`}
        aria-hidden
      />
    </span>
  );
}

// =============================================================================
// SidebarSection — unchanged
// =============================================================================

function SidebarSection({
  label,
  children,
  action,
}: {
  label: string;
  children: ReactNode;
  action?: { icon: ReactNode; href: string; ariaLabel: string };
}) {
  return (
    <section className="bb-shell-section">
      <header className="bb-shell-section-head">
        <span className="bb-shell-section-label">{label}</span>
        {action && (
          <Link
            href={action.href}
            className="bb-shell-section-action"
            aria-label={action.ariaLabel}
            title={action.ariaLabel}
          >
            {action.icon}
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}

// =============================================================================
// Utilities
// =============================================================================

function formatRelative(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}
