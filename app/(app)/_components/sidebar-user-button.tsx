// app/(app)/_components/sidebar-user-button.tsx
//
// The user button at the bottom of the (app) sidebar.
//
// Receives the user as a prop from the (app) layout (which fetches it on
// the server). When clicked, opens a small menu with the user's email and
// a "Sign out" action. The Sign Out is submitted as a POST to /auth/signout
// via a hidden form (CSRF-safe, matches the route handler's POST-only
// design).
//
// Why this is a Client Component:
//   The menu open/close state, click-outside handling, and form submission
//   all require client-side interactivity. The user data itself is passed
//   in as a prop, fetched once on the server.
//
// Display rules:
//   - Avatar: first letter of email (uppercase) on a gold (--bb-highlight)
//     background, matches existing sidebar avatar styling
//   - Primary line: the part of the email before the @ symbol (so
//     "anna.smith@firm.com.au" → "anna.smith")
//   - Secondary line: the full email, truncated if too long
//
// We never show "Sign in" here when the user IS signed in. The signed-out
// state is handled separately — the AppSidebar component decides whether
// to render this signed-in button or the "Sign in" link.

'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';

interface SidebarUserButtonProps {
  email: string;
  /** Optional display name from auth.users.user_metadata (e.g. Google profile name). */
  displayName?: string | null;
}

export function SidebarUserButton({ email, displayName }: SidebarUserButtonProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close on click outside.
  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // First letter for the avatar. Falls back to '?' for absurd edge cases.
  const avatarLetter = (displayName?.trim()?.[0] || email[0] || '?').toUpperCase();

  // Primary label — display name if we have one, else the local part of the email.
  const primaryLabel = displayName?.trim() || email.split('@')[0] || email;

  const handleToggle = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen((v) => !v);
  }, []);

  return (
    <div ref={containerRef} className="bb-shell-user-wrap">
      <button
        type="button"
        className="bb-shell-user"
        title={email}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={handleToggle}
      >
        <span className="bb-shell-user-avatar" aria-hidden>
          {avatarLetter}
        </span>
        <span className="bb-shell-user-body">
          <span className="bb-shell-user-name">{primaryLabel}</span>
          <span className="bb-shell-user-meta">{email}</span>
        </span>
      </button>

      {open && (
        <div className="bb-shell-user-menu" role="menu" aria-label="Account menu">
          <div className="bb-shell-user-menu-header">
            <span className="bb-shell-user-menu-name">{primaryLabel}</span>
            <span className="bb-shell-user-menu-email">{email}</span>
          </div>
          <div className="bb-shell-user-menu-divider" />
          {/* Practitioner profile — shapes how chat answers are written. */}
          <Link
            href="/settings"
            className="bb-shell-user-menu-item"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            Settings
          </Link>
          <div className="bb-shell-user-menu-divider" />
          {/* Sign out is a real form POST so it works without JS and is
              CSRF-resistant. The /auth/signout route only accepts POST. */}
          <form action="/auth/signout" method="post" className="bb-shell-user-menu-form">
            <button
              type="submit"
              className="bb-shell-user-menu-item"
              role="menuitem"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

// Signed-out variant: just a "Sign in" link. Kept in the same file so the
// AppSidebar's import surface is small.

export function SidebarSignInButton() {
  return (
    <Link href="/login" className="bb-shell-user" title="Sign in to BriefBridge">
      <span className="bb-shell-user-avatar" aria-hidden>
        ?
      </span>
      <span className="bb-shell-user-body">
        <span className="bb-shell-user-name">Sign in</span>
        <span className="bb-shell-user-meta">Create an account</span>
      </span>
    </Link>
  );
}
