// lib/analytics.ts
//
// Fire-and-forget usage tracking. trackEvent NEVER throws and NEVER blocks
// the caller — analytics must not be able to break or slow the product.
//
// Usage (server-side only):
//   void trackEvent(user.id, 'chat_query', { caselawHits: 12 });
//   void trackEvent(null, 'page_view', { path: '/legislation/nsw/...' });

import { db } from '@/lib/db';
import { analyticsEvents } from '@/lib/db/schema';

/**
 * Accounts whose activity is EXCLUDED from analytics.
 *
 * The founder has been clicking his own site while building it. Left in, that
 * traffic is indistinguishable from real interest and makes the numbers
 * actively misleading — worse than having no numbers, because it invites
 * decisions based on fiction.
 *
 * This is also the gate list for /admin/analytics itself. Kept here rather
 * than duplicated because a list that appears in three files eventually
 * disagrees with itself.
 *
 * LIMITATION, stated plainly: this only excludes SIGNED-IN visits. Browsing
 * the public pages while logged out still records a page view, because there
 * is nothing to match on and fingerprinting anonymous visitors to filter one
 * person would be both creepy and unreliable. Vercel Analytics covers that
 * gap better — its city breakdown makes Newcastle traffic obvious at a
 * glance.
 */
export const ADMIN_EMAILS = ['osr9915@gmail.com'];

export type AnalyticsEventType =
  | 'chat_query'        // a user message hit the chat route
  | 'search_empty'      // a chat query where retrieval returned nothing
  | 'page_view'         // a page was viewed (signed in or not)
  | 'session_start';    // reserved for future client-side use

/**
 * Records an event.
 *
 * userId is nullable: page views mostly come from logged-out visitors, and
 * null means "not signed in" rather than "missing". See migration 0023.
 */
export async function trackEvent(
  userId: string | null,
  eventType: AnalyticsEventType,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db.insert(analyticsEvents).values({
      userId,
      eventType,
      metadata,
    });
  } catch (err) {
    // Swallow — analytics failures must never surface to users.
    // eslint-disable-next-line no-console
    console.error(
      '[analytics] trackEvent failed:',
      err instanceof Error ? err.message : String(err),
    );
  }
}