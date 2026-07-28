// app/_actions/track.ts
//
// Server action behind the page-view tracker.
//
// 'use server' rule observed throughout this codebase: async function exports
// ONLY. No type re-exports — Turbopack keeps dangling references to them and
// they fail at runtime.
//
// =============================================================================
// WHAT THIS DELIBERATELY DOES NOT TRUST
// =============================================================================
//
// The path arrives from the browser, so it is treated as hostile input:
//
//   - Anything that isn't a same-origin absolute path ("/...") is dropped.
//     A client that sends "https://evil.example" or "../../etc" writes
//     nothing.
//   - The QUERY STRING IS STRIPPED before storage. Several routes carry
//     conversation ids and invite tokens in the query, and an analytics table
//     is the wrong place for either — it is read by a dashboard, not covered
//     by the same access rules as the resources those ids point at.
//   - Length is capped, so a long URL can't be used to bloat rows.
//
// The USER ID never comes from the client at all — it is read from the
// session here. A client-supplied user id would let anyone attribute traffic
// to anyone.

'use server';

import { createClient } from '@/lib/supabase/server';
import { trackEvent, ADMIN_EMAILS } from '@/lib/analytics';

const MAX_PATH_LENGTH = 200;

export async function trackPageViewAction(rawPath: string): Promise<void> {
  // Never record local development traffic — it would swamp real numbers.
  if (process.env.NODE_ENV !== 'production') return;

  const path = sanitisePath(rawPath);
  if (!path) return;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // The founder's own signed-in browsing is excluded — see the note on
    // ADMIN_EMAILS in lib/analytics.ts.
    if (user && ADMIN_EMAILS.includes(user.email ?? '')) return;

    await trackEvent(user?.id ?? null, 'page_view', {
      path,
      signedIn: Boolean(user),
    });
  } catch (err) {
    // A tracking failure must never surface. trackEvent already swallows its
    // own errors; this catches a failure in the auth lookup above.
    // eslint-disable-next-line no-console
    console.error(
      '[analytics] trackPageView failed:',
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Returns a safe, query-free path, or null if the input isn't usable. */
function sanitisePath(input: unknown): string | null {
  if (typeof input !== 'string') return null;

  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  // "//host" and "/\host" are protocol-relative URLs, not local paths.
  if (trimmed.startsWith('//') || trimmed.startsWith('/\\')) return null;

  const withoutQuery = trimmed.split('?')[0].split('#')[0];
  if (withoutQuery.length === 0) return null;

  return withoutQuery.slice(0, MAX_PATH_LENGTH);
}