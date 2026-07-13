// lib/analytics.ts
//
// Fire-and-forget usage tracking. trackEvent NEVER throws and NEVER blocks
// the caller — analytics must not be able to break or slow the product.
//
// Usage (in a route handler / server code only):
//   void trackEvent(user.id, 'chat_query', { caselawHits: 12 });

import { db } from '@/lib/db';
import { analyticsEvents } from '@/lib/db/schema';

export type AnalyticsEventType =
  | 'chat_query'        // a user message hit the chat route
  | 'search_empty'      // a chat query where retrieval returned nothing
  | 'session_start';    // reserved for future client-side use

export async function trackEvent(
  userId: string,
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
    console.error('[analytics] trackEvent failed:', err instanceof Error ? err.message : String(err));
  }
}