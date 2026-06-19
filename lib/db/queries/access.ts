// lib/db/queries/access.ts
//
// THE access-control helpers for firm collaboration. Every matter-scoped
// read/write will eventually route through one of these two functions.
//
// The model (two concentric rings inside a firm):
//
//   userCanSeeMatterCard  — can the user see the matter EXISTS (card only:
//                           name, client, status, assignees)?
//                           → TRUE if the matter is in the user's firm.
//
//   userCanAccessMatter   — can the user go INSIDE (files, AI research,
//                           case chat, editing)?
//                           → TRUE if the user is ASSIGNED to the matter.
//
// Plus a firm-membership lookup the rest of the app needs.
//
// IMPORTANT: these are the application-layer first line of defense. RLS is the
// second line (Slice 3). Until Slice 3, these helpers are the ONLY thing
// enforcing firm isolation — so every matter query must use them.
//
// These functions are ADDITIVE in this slice. Adding this file changes no
// behaviour: existing queries still use their old userId filters until we
// swap them over one at a time.

import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  matters,
  matterAssignments,
  firmMemberships,
  type FirmRole,
} from '@/lib/db/schema';

// =============================================================================
// Firm membership
// =============================================================================

export interface UserFirmMembership {
  firmId: string;
  role: FirmRole;
}

/**
 * Returns the user's firm membership (firmId + role), or null if the user
 * belongs to no firm. v1 = one firm per user, so this is a single row.
 *
 * Used everywhere we need "which firm is this user in" — the matter card
 * directory, member management, etc.
 */
export async function getUserFirmMembership(
  userId: string,
): Promise<UserFirmMembership | null> {
  const rows = await db
    .select({
      firmId: firmMemberships.firmId,
      role: firmMemberships.role,
    })
    .from(firmMemberships)
    .where(eq(firmMemberships.userId, userId))
    .limit(1);

  return rows[0] ?? null;
}

// =============================================================================
// Ring 1 — can the user SEE the matter card? (matter is in their firm)
// =============================================================================

/**
 * TRUE if the matter belongs to the same firm the user is a member of.
 *
 * This gates the firm-wide card directory: every firm member can see that a
 * matter exists (name, client, status, who's assigned) even if they're not
 * assigned to it. It does NOT grant access to the matter's contents — that's
 * userCanAccessMatter.
 *
 * Returns false if the matter doesn't exist, the user is in no firm, or the
 * matter is in a different firm.
 */
export async function userCanSeeMatterCard(
  userId: string,
  matterId: string,
): Promise<boolean> {
  const rows = await db
    .select({ matterId: matters.id })
    .from(matters)
    .innerJoin(firmMemberships, eq(firmMemberships.firmId, matters.firmId))
    .where(and(eq(matters.id, matterId), eq(firmMemberships.userId, userId)))
    .limit(1);

  return rows.length > 0;
}

// =============================================================================
// Ring 2 — can the user go INSIDE the matter? (user is assigned)
// =============================================================================

/**
 * TRUE if the user is assigned to the matter (has a matter_assignments row).
 *
 * This gates EVERYTHING inside a matter: files, AI research, case chat,
 * editing. A firm member who can see the card but isn't assigned gets FALSE
 * here — they can see it exists but can't go in.
 *
 * Returns false if the matter doesn't exist or the user isn't assigned.
 *
 * NOTE: this checks assignment only. It deliberately does NOT also re-check
 * firm membership, because an assignment can only exist for a matter in the
 * user's firm (assignments are created through firm-scoped flows). If that
 * invariant is ever in doubt, this is the place to add a belt-and-braces
 * firm check — but for now, assignment is the single source of truth for
 * inside-access.
 */
export async function userCanAccessMatter(
  userId: string,
  matterId: string,
): Promise<boolean> {
  const rows = await db
    .select({ matterId: matterAssignments.matterId })
    .from(matterAssignments)
    .where(
      and(
        eq(matterAssignments.matterId, matterId),
        eq(matterAssignments.userId, userId),
      ),
    )
    .limit(1);

  return rows.length > 0;
}