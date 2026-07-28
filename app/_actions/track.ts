// app/_actions/track.ts
//
// Server action behind the page-view tracker.
//
// 'use server' rule observed throughout this codebase: async function exports
// ONLY. No type re-exports — Turbopack keeps dangling references to them and
// they fail at runtime.
//
// =============================================================================
// WHERE THE CITY COMES FROM
// =============================================================================
//
// Vercel resolves the visitor's IP to a location at the edge and injects it
// as request headers before our code runs. We read those rather than doing
// any lookup ourselves, which means:
//
//   - No IP is ever stored. The header is already coarse ("Newcastle"), and
//     the raw address never reaches this function.
//   - No third-party geo service, no extra latency, nothing to pay for.
//   - Vercel's own dashboard shows COUNTRY only unless you upgrade to
//     Analytics Plus. The city header is present regardless, so reading it
//     here gets the breakdown for nothing.
//
// The headers are absent in local development, which is fine — tracking is
// disabled there anyway.
//
// =============================================================================
// WHAT THIS DELIBERATELY DOES NOT TRUST
// =============================================================================
//
// The path arrives from the browser, so it is treated as hostile input:
//
//   - Anything that isn't a same-origin absolute path ("/...") is dropped.
//   - The QUERY STRING IS STRIPPED before storage. Several routes carry
//     conversation ids and invite tokens in the query, and an analytics table
//     is the wrong place for either.
//   - Length is capped, so a long URL can't be used to bloat rows.
//
// The USER ID never comes from the client at all — it is read from the
// session here. A client-supplied user id would let anyone attribute traffic
// to anyone. The geo headers are set by Vercel's edge, not the browser, so
// they cannot be spoofed by a visitor.

'use server';

import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { trackEvent, ADMIN_EMAILS } from '@/lib/analytics';

const MAX_PATH_LENGTH = 200;
const MAX_PLACE_LENGTH = 80;

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

    const h = await headers();

    await trackEvent(user?.id ?? null, 'page_view', {
      path,
      signedIn: Boolean(user),
      // Vercel percent-encodes the city, so "Coffs Harbour" arrives as
      // "Coffs%20Harbour" and would otherwise group as its own value.
      city: readPlace(h.get('x-vercel-ip-city')),
      region: readPlace(h.get('x-vercel-ip-country-region')),
      country: readPlace(h.get('x-vercel-ip-country')),
    });
  } catch (err) {
    // A tracking failure must never surface. trackEvent already swallows its
    // own errors; this catches a failure in the auth or header lookup above.
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

/** Decodes a Vercel geo header. Null when absent or malformed. */
function readPlace(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw).trim();
    return decoded.length > 0 ? decoded.slice(0, MAX_PLACE_LENGTH) : null;
  } catch {
    // decodeURIComponent throws on a malformed sequence — keep the raw value
    // rather than losing the data point entirely.
    return raw.slice(0, MAX_PLACE_LENGTH);
  }
}