// lib/billing/require-subscription.ts
//
// Server-side entitlement gate.
//
// WHERE TO ENFORCE: at the point of expense, not at the perimeter. The gate
// goes on the chat route (every message costs Anthropic + Voyage credits) and
// on the pages that constitute the paid product. It deliberately does NOT go
// on the public marketing surface, the legislation SEO pages, or the demo —
// those exist to bring people in.
//
// FAILS CLOSED: getAccessState returns NO_ACCESS on a database error, so a
// blip denies access rather than handing out free inference. That's the right
// direction for the failure — a user seeing "check your billing" once is a
// support message; the alternative is an open bar on your API costs.

import { getAccessState, type AccessState } from '@/lib/db/queries/subscription';

export interface EntitlementResult {
  allowed: boolean;
  access: AccessState;
}

/**
 * Checks entitlement for a user. Returns the full access state so callers can
 * tailor the message (trial expired vs payment failed vs never subscribed).
 */
export async function checkEntitlement(
  userId: string,
): Promise<EntitlementResult> {
  const access = await getAccessState(userId);
  return { allowed: access.hasAccess, access };
}

/**
 * A user-facing explanation of why access was refused, and where to go.
 * Kept here so the wording is identical everywhere it surfaces.
 */
export function entitlementMessage(access: AccessState): string {
  switch (access.status) {
    case 'past_due':
    case 'unpaid':
      return 'Your last payment didn’t go through. Update your card on the billing page to restore access.';
    case 'canceled':
      return 'Your subscription has ended. Resubscribe on the billing page to continue.';
    case 'incomplete':
    case 'incomplete_expired':
      return 'Your subscription wasn’t completed. Start again from the billing page.';
    case 'paused':
      return 'Your subscription is paused. Resume it on the billing page.';
    default:
      return 'Start your free trial to use BriefBridge research.';
  }
}