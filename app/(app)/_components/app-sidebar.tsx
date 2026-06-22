// app/(app)/_components/app-sidebar.tsx
//
// MULTI-FIRM (My cases / Firm cases):
//   - `personalFirmId` prop (from layout.tsx via getUserPersonalFirmId).
//   - Flat matters list split into "My cases" (firmId === personalFirmId) and
//     "Firm cases" (shared firms). "Firm cases" only renders when present.
//   - The provider still holds the flat matters list (optimistic-update
//     machinery unchanged); the split happens here at render via firmId.
//
//   - NEW: `hasSharedFirm` prop. When false, an "Upgrade to a firm" affordance
//     appears (bottom of sidebar). Clicking it calls upgradeToFirmAction, which
//     creates a shared firm (5 seats) owned by the user, leaving their personal
//     firm untouched. After success we router.refresh() so hasSharedFirm flips
//     and the affordance disappears.
//
// What changed in Chunk 5:
//   - `recentResearch` prop fetched server-side by layout.tsx.
//   - "New chat" → "New research"; "Recent chats" → "Recent research".

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
  Building2,
  FilePlus,
  MessageSquare,
  PenSquare,
  Scale,
} from 'lucide-react';
import { useMatters } from '../matters/_components/matters-provider';
import type { MatterStatus } from '../matters/_data/mock-matters';
import type { Conversation, Matter } from '@/lib/db/schema';
import { upgradeToFirmAction } from '../_actions/firm';
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
   * The user's PERSONAL firm id (the is_personal firm-of-one). Matters whose
   * firmId matches this are "My cases"; all others are "Firm cases". May be
   * null in the unlikely case the user has no personal firm — then everything
   * falls into "My cases" (safe default).
   */
  personalFirmId: string | null;
  /**
   * Whether the user already belongs to a SHARED (non-personal) firm. When
   * false, the "Upgrade to a firm" affordance is shown. When true, it's hidden
   * (they've already upgraded).
   */
  hasSharedFirm: boolean;
  /**
   * Recent conversations (research sessions) across all matters + standalone,
   * most-recently-updated first. Fetched server-side in layout.tsx via
   * listConversations(userId, { limit: 5 }).
   */
  recentResearch: Conversation[];
}

// =============================================================================
// AppSidebar
// =============================================================================

export function AppSidebar({
  user,
  personalFirmId,
  hasSharedFirm,
  recentResearch,
}: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { matters } = useMatters();

  // Build a Map<matterId, matterName> for fast lookup when rendering
  // recent-research items.
  const matterNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of matters) {
      map.set(m.id, m.name);
    }
    return map;
  }, [matters]);

  // Split the flat matters list into My cases / Firm cases by firmId.
  const { myCases, firmCases } = useMemo(() => {
    const mine: Matter[] = [];
    const firm: Matter[] = [];
    for (const m of matters) {
      if (personalFirmId && m.firmId === personalFirmId) {
        mine.push(m);
      } else if (personalFirmId) {
        firm.push(m);
      } else {
        mine.push(m);
      }
    }
    return { myCases: mine, firmCases: firm };
  }, [matters, personalFirmId]);

  const [mobileOpen, setMobileOpen] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
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

  // Start a fresh research session (see prior notes on push + refresh).
  function handleNewResearch() {
    if (pathname === '/chat') {
      if (typeof window !== 'undefined') {
        window.history.replaceState({}, '', '/chat');
      }
      router.refresh();
    } else {
      router.push('/chat');
      router.refresh();
    }
    setMobileOpen(false);
  }

  // Upgrade to a firm: create a shared firm owned by the user, then refresh so
  // the server re-fetches hasSharedFirm (flips to true) and this affordance
  // disappears. Guard against double-clicks with `upgrading`.
  async function handleUpgradeToFirm() {
    if (upgrading) return;
    setUpgrading(true);
    try {
      const result = await upgradeToFirmAction();
      if (result.ok) {
        router.refresh();
      } else {
        // eslint-disable-next-line no-console
        console.error('Upgrade to firm failed:', result.error);
        setUpgrading(false);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Upgrade to firm threw:', err);
      setUpgrading(false);
    }
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
          label="My cases"
          action={{
            icon: <FilePlus size={14} strokeWidth={1.75} />,
            href: '/matters',
            ariaLabel: 'View all cases',
          }}
        >
          <CaseList matters={myCases} pathname={pathname} />
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

        {firmCases.length > 0 && (
          <SidebarSection label="Firm cases">
            <CaseList matters={firmCases} pathname={pathname} />
          </SidebarSection>
        )}

        <div className="bb-shell-bottom">
          {!hasSharedFirm && (
            <button
              type="button"
              className="bb-shell-secondary-link bb-shell-upgrade-firm"
              onClick={handleUpgradeToFirm}
              disabled={upgrading}
              title="Start with 5 users, add as many as you like"
              aria-label="Upgrade to a firm — start with 5 users, add as many as you like"
            >
              <span className="bb-shell-secondary-icon" aria-hidden>
                <Building2 size={16} strokeWidth={1.75} />
              </span>
              <span className="bb-shell-secondary-label">
                {upgrading ? 'Creating firm…' : 'Upgrade to a firm'}
              </span>
            </button>
          )}

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
// CaseList — renders a list of matter rows. Shared by My cases / Firm cases.
// =============================================================================

function CaseList({
  matters,
  pathname,
}: {
  matters: Matter[];
  pathname: string;
}) {
  if (matters.length === 0) {
    return (
      <ul className="bb-shell-list">
        <li className="bb-shell-list-empty">No cases yet</li>
      </ul>
    );
  }
  return (
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
