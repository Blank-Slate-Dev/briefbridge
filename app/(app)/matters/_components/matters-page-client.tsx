// app/(app)/matters/_components/matters-page-client.tsx
//
// Client portion of the matters list page. Reads from the MattersProvider
// (which the (app) layout populates with server-fetched data) so status
// changes propagate live.
//
// The server page (page.tsx) passes the initial matters down so this
// component can render correctly on the first render BEFORE the provider's
// state has had a chance to sync. After hydration, the provider's state
// becomes the source of truth and any changes (status update, new matter)
// reflect immediately.

'use client';

import Link from 'next/link';
import { useTransition } from 'react';
import { useMatters } from './matters-provider';
import { StatusMenu } from './status-menu';
import { createNewMatterAction } from '../_actions';
import type { Matter } from '@/lib/db/schema';

interface MattersPageClientProps {
  /**
   * Initial matters from the server. Used only on the first render —
   * after that, the MattersProvider's state is the source of truth.
   *
   * The provider seeded itself with the same data from the (app) layout,
   * so these two views agree at mount.
   */
  matters: Matter[];
}

export function MattersPageClient({ matters: initialMatters }: MattersPageClientProps) {
  // Read live matters from the provider. The provider was seeded with the
  // same data from the layout, so on first render this matches initialMatters
  // exactly. After any client-side update (status change, new matter),
  // this reflects the change.
  const { matters } = useMatters();

  // If the provider somehow hasn't been mounted yet (shouldn't happen, but
  // defensive), fall back to the initial server data.
  const displayMatters = matters.length > 0 ? matters : initialMatters;
  const count = displayMatters.length;

  return (
    <main className="bb-matters-main">
      <header className="bb-matters-head">
        <div className="bb-matters-head-row">
          <div>
            <div className="bb-section-eyebrow">Your workspace</div>
            <h1 className="bb-matters-title">
              Cases <em>and matters</em>
            </h1>
            <p className="bb-matters-sub">
              Each case keeps your research, files, and conversations in one
              place. Ask BriefBridge anything in context — your facts, your
              authorities.
            </p>
          </div>

          {/* New-case action lives in the header toolbar, anchored right. */}
          <NewMatterButton />
        </div>
      </header>

      {count === 0 ? (
        <div className="bb-matters-empty">
          <h2 className="bb-matters-empty-title">No cases yet</h2>
          <p className="bb-matters-empty-text">
            Create your first case to start a workspace for your research,
            files, and conversations.
          </p>
          <NewMatterButton variant="empty" />
        </div>
      ) : (
        <>
          <p className="bb-matters-count">
            {count} {count === 1 ? 'case' : 'cases'}
          </p>
          <section className="bb-matters-grid">
            {displayMatters.map((m) => (
              <MatterCard key={m.id} matter={m} />
            ))}
          </section>
        </>
      )}
    </main>
  );
}

// =============================================================================
// Matter card
// =============================================================================

function MatterCard({ matter }: { matter: Matter }) {
  // Matters fetched from the DB don't have files/conversations/authorities
  // counts yet — those will come in later chunks (Files, Conversations,
  // Authorities tracking). For now we show the description, status, and
  // a relative timestamp.
  return (
    <Link href={`/matters/${matter.id}`} className="bb-matter-card">
      <div className="bb-matter-card-head">
        <div className="bb-matter-card-name-block">
          <h3 className="bb-matter-card-name">{matter.name}</h3>
          {matter.client && (
            <p className="bb-matter-card-client">{matter.client}</p>
          )}
        </div>
        <StatusMenu matterId={matter.id} size="card" />
      </div>

      {matter.description && (
        <p className="bb-matter-card-desc">{matter.description}</p>
      )}

      <div className="bb-matter-card-stats">
        <span className="bb-matter-card-time">
          Updated {formatRelative(matter.updatedAt)}
        </span>
      </div>
    </Link>
  );
}

// =============================================================================
// New matter button — quick-create. Used in the header (default) and in the
// empty state (variant="empty"). Both fire the same create action.
// =============================================================================

function NewMatterButton({ variant = 'header' }: { variant?: 'header' | 'empty' }) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    // Server action handles creation + redirect. We just trigger it.
    startTransition(async () => {
      await createNewMatterAction();
    });
  }

  const className =
    variant === 'empty'
      ? 'bb-btn bb-btn-primary bb-btn-large'
      : 'bb-btn bb-btn-primary bb-matters-new-btn';

  return (
    <button
      type="button"
      className={className}
      onClick={handleClick}
      disabled={isPending}
      aria-label="Create new case"
    >
      <span className="bb-matters-new-btn-plus" aria-hidden>
        +
      </span>
      {isPending ? 'Creating…' : 'New case'}
    </button>
  );
}

// =============================================================================
// Relative time formatter
// =============================================================================
//
// Minimal helper to render "2 hours ago" / "Yesterday" / etc. Self-contained
// to avoid pulling in date-fns just for this. If we later need more locale
// or format flexibility, swap to Intl.RelativeTimeFormat which is built-in.

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
  return d.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
