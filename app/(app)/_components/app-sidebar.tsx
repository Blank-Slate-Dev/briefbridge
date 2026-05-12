// app/(app)/_components/app-sidebar.tsx
'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  useEffect,
  useId,
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
import {
  SidebarUserButton,
  SidebarSignInButton,
} from './sidebar-user-button';

// =============================================================================
// Types — placeholder until conversation persistence ships
// =============================================================================

interface RecentChat {
  id: string;
  title: string;
  /** Human-readable timestamp like "2 hours ago". */
  updatedAt: string;
}

const PLACEHOLDER_RECENT_CHATS: RecentChat[] = [
  {
    id: 'rc1',
    title: 'Costs apportionment when one claim is undetermined',
    updatedAt: '2 hours ago',
  },
  {
    id: 'rc2',
    title: 'Setting aside default judgments',
    updatedAt: 'Yesterday',
  },
];

// =============================================================================
// Props
// =============================================================================
//
// The layout (Server Component) fetches the user on the server and passes
// their email + display name in. If the user is null, we render the
// signed-out variant of the user button at the bottom of the sidebar.
//
// (In practice the middleware redirects unauthenticated users away from
// (app) routes, so `user` should always be non-null here — but we render
// defensively in case of edge cases like a logged-out user briefly seeing
// a cached client render.)

export interface AppSidebarProps {
  user: {
    email: string;
    displayName: string | null;
  } | null;
}

// =============================================================================
// AppSidebar
// =============================================================================

export function AppSidebar({ user }: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  // Pull matters from the provider so status changes update the case icons.
  const { matters } = useMatters();

  // Mobile drawer open/closed.
  const [mobileOpen, setMobileOpen] = useState(false);

  // Ghost-click protection: iOS fires a synthetic click ~300ms after a tap
  // on the same coordinates. If the hamburger triggers the drawer open and
  // then disappears (display: none), the ghost click falls through to the
  // backdrop and closes the drawer immediately. Track the open timestamp
  // and ignore backdrop clicks that arrive within that window.
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
    // Ignore the first close attempt within 400ms of opening (ghost click).
    if (Date.now() - openedAtRef.current < 400) return;
    setMobileOpen(false);
  }

  // Reference to the sidebar element so we can blur focus that's inside it
  // after navigation. The CSS uses :focus-within to drive the expanded state,
  // so when a user clicks a sidebar link, focus stays on that link and the
  // sidebar refuses to collapse on mouse-out. By blurring after navigation
  // we let the sidebar collapse normally as soon as the cursor leaves.
  const sidebarRef = useRef<HTMLElement | null>(null);

  // Close mobile drawer on route change.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // After every navigation: if the focused element is inside the sidebar,
  // blur it. This kills the lingering :focus-within state without affecting
  // keyboard users who Tab through the sidebar.
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

  // Lock body scroll while mobile drawer is open.
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

  // Close on Escape key while mobile drawer is open.
  useEffect(() => {
    if (!mobileOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMobileOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const navId = useId();

  function handleNewChat() {
    router.push('/chat');
    setMobileOpen(false);
  }

  return (
    <>
      {/* Mobile hamburger button (only visible on small screens) */}
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

      {/* Backdrop for mobile drawer */}
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
          onClick={handleNewChat}
          title="Start a new chat"
          aria-label="Start a new chat"
        >
          <span className="bb-shell-new-chat-icon" aria-hidden>
            <PenSquare size={16} strokeWidth={1.75} />
          </span>
          <span className="bb-shell-new-chat-label">New chat</span>
        </button>

        <SidebarSection label="Recent chats">
          <ul className="bb-shell-list">
            {PLACEHOLDER_RECENT_CHATS.length === 0 ? (
              <li className="bb-shell-list-empty">No recent chats</li>
            ) : (
              PLACEHOLDER_RECENT_CHATS.map((c) => (
                <li key={c.id}>
                  <Link
                    href="/chat"
                    className="bb-shell-list-item"
                    title={c.title}
                  >
                    <span className="bb-shell-list-item-icon" aria-hidden>
                      <MessageSquare size={16} strokeWidth={1.5} />
                    </span>
                    <span className="bb-shell-list-item-body">
                      <span className="bb-shell-list-item-title">
                        {c.title}
                      </span>
                      <span className="bb-shell-list-item-meta">
                        {c.updatedAt}
                      </span>
                    </span>
                  </Link>
                </li>
              ))
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
                      <span className="bb-shell-list-item-title">
                        {m.name}
                      </span>
                      <span className="bb-shell-list-item-meta">
                        {m.client}
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

          {/* Render the signed-in user button or the signed-out variant. */}
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
// CaseIcon — briefcase + status dot badge
// =============================================================================

/**
 * Renders the briefcase icon for a case with a small status dot in the
 * top-right corner like a notification badge.
 */
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
// SidebarSection
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
