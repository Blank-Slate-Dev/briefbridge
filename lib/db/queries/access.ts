// lib/db/queries/access.ts
//
// THE access-control helpers for firm collaboration. Every matter-scoped
// read/write will eventually route through one of these functions.
//
// The model (two concentric rings inside a firm):
//
//   userCanSeeMatterCard  — can the user see the matter EXISTS (card only:
//                           name, client, status, assignees)?
//                           → TRUE if the matter is in a firm the user is in.
//
//   userCanAccessMatter   — can the user go INSIDE (files, AI research,
//                           case chat, editing)?
//                           → TRUE if the user is ASSIGNED to the matter.
//
// Plus firm-membership lookups the rest of the app needs.
//
// MULTI-FIRM (My cases / Firm cases): a user can belong to MULTIPLE firms —
// their personal firm-of-one (is_personal = true, created at signup) PLUS any
// shared firms they've joined. "My cases" = matters in the personal firm;
// "Firm cases" = matters in joined firms. getUserFirmMemberships returns all
// of them; getUserPersonalFirmId resolves the personal one.
//
// IMPORTANT: these are the application-layer first line of defense. RLS is the
// second line. Every query here runs through withUser() so the session-variable
// RLS policies enforce the same firm/assignment scoping at the database level.

import { and, eq } from 'drizzle-orm';
import { withUser } from '@/lib/db/with-user';
import {
  matters,
  matterAssignments,
  firmMemberships,
  firms,
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
 * Returns ONE of the user's firm memberships (firmId + role), or null if the
 * user belongs to no firm.
 *
 * NOTE: with multi-firm, a user can have several memberships. This returns an
 * arbitrary single one (LIMIT 1) and exists mainly for "does this user have
 * ANY membership" checks. For the My/Firm split or anything that needs all of
 * a user's firms, use getUserFirmMemberships instead.
 */
export async function getUserFirmMembership(
  userId: string,
): Promise<UserFirmMembership | null> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({
        firmId: firmMemberships.firmId,
        role: firmMemberships.role,
      })
      .from(firmMemberships)
      .where(eq(firmMemberships.userId, userId))
      .limit(1),
  );

  return rows[0] ?? null;
}

export interface UserFirmMembershipFull {
  firmId: string;
  role: FirmRole;
  isPersonal: boolean;
}

/**
 * Returns ALL of the user's firm memberships (firmId + role + isPersonal).
 *
 * Multi-firm: a lawyer has their personal firm-of-one PLUS any firms they've
 * joined. Used to build the "My cases" / "Firm cases" buckets and to resolve
 * which firms' matters a user can see.
 */
export async function getUserFirmMemberships(
  userId: string,
): Promise<UserFirmMembershipFull[]> {
  return withUser(userId, (tx) =>
    tx
      .select({
        firmId: firmMemberships.firmId,
        role: firmMemberships.role,
        isPersonal: firms.isPersonal,
      })
      .from(firmMemberships)
      .innerJoin(firms, eq(firms.id, firmMemberships.firmId))
      .where(eq(firmMemberships.userId, userId)),
  );
}

/**
 * Returns the user's PERSONAL firm id (the firm-of-one created at signup,
 * flagged is_personal = true, where they are owner). This is the firm that
 * backs "My cases".
 *
 * Returns null if somehow absent (shouldn't happen post-bootstrap, but callers
 * should handle it — e.g. fall back to treating all matters as "My cases").
 */
export async function getUserPersonalFirmId(
  userId: string,
): Promise<string | null> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({ firmId: firmMemberships.firmId })
      .from(firmMemberships)
      .innerJoin(firms, eq(firms.id, firmMemberships.firmId))
      .where(
        and(
          eq(firmMemberships.userId, userId),
          eq(firms.isPersonal, true),
          eq(firmMemberships.role, 'owner'),
        ),
      )
      .limit(1),
  );

  return rows[0]?.firmId ?? null;
}

// =============================================================================
// Ring 1 — can the user SEE the matter card? (matter is in one of their firms)
// =============================================================================

/**
 * TRUE if the matter belongs to a firm the user is a member of.
 *
 * This gates the firm-wide card directory: every firm member can see that a
 * matter exists (name, client, status, who's assigned) even if they're not
 * assigned to it. It does NOT grant access to the matter's contents — that's
 * userCanAccessMatter.
 *
 * Multi-firm note: the join naturally covers ALL of the user's firms — the
 * row matches if the matter's firm_id equals ANY firm the user is a member of
 * (personal or joined). So a matter in any of the user's firms is card-visible.
 *
 * Returns false if the matter doesn't exist, the user is in no firm, or the
 * matter is in a firm the user is not a member of.
 */
export async function userCanSeeMatterCard(
  userId: string,
  matterId: string,
): Promise<boolean> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({ matterId: matters.id })
      .from(matters)
      .innerJoin(firmMemberships, eq(firmMemberships.firmId, matters.firmId))
      .where(and(eq(matters.id, matterId), eq(firmMemberships.userId, userId)))
      .limit(1),
  );

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
 * Multi-firm note: with uniform assignment (every matter, personal or firm,
 * has an assignment row for each user who can open it), this single rule —
 * "can access ⟺ assigned" — holds for both My cases and Firm cases. Personal
 * matters get a self-assignment row at creation (and existing ones were
 * backfilled), so the personal owner passes here too.
 *
 * Returns false if the matter doesn't exist or the user isn't assigned.
 *
 * NOTE: this checks assignment only. It deliberately does NOT also re-check
 * firm membership, because an assignment can only exist for a matter in one of
 * the user's firms (assignments are created through firm-scoped flows). If that
 * invariant is ever in doubt, this is the place to add a belt-and-braces firm
 * check — but for now, assignment is the single source of truth for
 * inside-access.
 */
export async function userCanAccessMatter(
  userId: string,
  matterId: string,
): Promise<boolean> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({ matterId: matterAssignments.matterId })
      .from(matterAssignments)
      .where(
        and(
          eq(matterAssignments.matterId, matterId),
          eq(matterAssignments.userId, userId),
        ),
      )
      .limit(1),
  );

  return rows.length > 0;
}