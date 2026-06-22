// lib/db/queries/matters.ts
//
// Query helpers for the `matters` table.
//
// MULTI-FIRM ACCESS MODEL (replaces the old userId-ownership model):
//
//   A matter belongs to a FIRM (matters.firm_id), not a single user. Access
//   is governed by two rings:
//
//     Ring 1 (see the card)  — the matter is in a firm the user is a MEMBER of.
//                              Used for the list + getMatter. Lets a firm
//                              member SEE a matter exists even if not assigned.
//
//     Ring 2 (go inside/edit) — the user is ASSIGNED to the matter
//                              (matter_assignments row). Used for every MUTATION
//                              here, and (separately) by the detail page to gate
//                              opening the matter.
//
//   "My cases"  = matters whose firm is the user's PERSONAL firm (is_personal).
//   "Firm cases"= matters in any SHARED firm the user has joined.
//   This file returns the flat union (all firms the user is in); the UI buckets
//   by firm_id. See lib/db/queries/access.ts for getUserPersonalFirmId.
//
// IMPORTANT: these are the application-layer first line of defense. RLS is the
// second. Every query runs through withUser() so the session-variable RLS
// policies enforce the same firm/assignment scoping at the DB level.

import { and, desc, eq, exists, isNull, sql } from 'drizzle-orm';
import { withUser } from '@/lib/db/with-user';
import {
  matters,
  matterAssignments,
  firmMemberships,
  firms,
  type Matter,
  type NewMatter,
  type MatterStatus,
} from '@/lib/db/schema';

// Re-export MatterStatus so existing imports of
// `import { type MatterStatus } from '@/lib/db/queries/matters'`
// keep working without churn. The canonical definition lives in schema.ts.
export type { MatterStatus };

// =============================================================================
// List
// =============================================================================

export interface ListMattersOptions {
  /** Include archived matters in the result. Default: false. */
  includeArchived?: boolean;
}

/**
 * Returns all matters across ALL firms the user is a member of (personal +
 * joined), ordered by most-recently-updated first. This is Ring 1 (card
 * visibility): a firm member sees every matter in their firms, whether or not
 * they're assigned to it. The detail page gates INSIDE-access separately via
 * userCanAccessMatter.
 *
 * The UI splits this flat list into "My cases" (firm is the user's personal
 * firm) and "Firm cases" (shared firms) using matter.firmId — see the matters
 * page / sidebar.
 *
 * By default, archived matters (archived_at IS NOT NULL) are excluded.
 */
export async function listMattersForUser(
  userId: string,
  options: ListMattersOptions = {},
): Promise<Matter[]> {
  const conditions = [eq(firmMemberships.userId, userId)];
  if (!options.includeArchived) {
    conditions.push(isNull(matters.archivedAt));
  }

  return withUser(userId, (tx) =>
    tx
      .select({
        id: matters.id,
        firmId: matters.firmId,
        userId: matters.userId,
        name: matters.name,
        client: matters.client,
        description: matters.description,
        status: matters.status,
        notes: matters.notes,
        archivedAt: matters.archivedAt,
        aiAccessMode: matters.aiAccessMode,
        aiAccessCommittedAt: matters.aiAccessCommittedAt,
        createdAt: matters.createdAt,
        updatedAt: matters.updatedAt,
      })
      .from(matters)
      .innerJoin(firmMemberships, eq(firmMemberships.firmId, matters.firmId))
      .where(and(...conditions))
      .orderBy(desc(matters.updatedAt)),
  );
}

// =============================================================================
// Get one
// =============================================================================

/**
 * Returns a single matter by id, IF it's in a firm the user is a member of
 * (Ring 1 — card visibility). Returns null if the matter doesn't exist OR is
 * in a firm the user isn't a member of.
 *
 * This deliberately uses card-visibility (firm membership), NOT assignment, so
 * the detail page can load the matter and THEN decide inside-access via
 * userCanAccessMatter (Ring 2). A firm-mate's matter the user isn't assigned to
 * still returns here (the page then redirects them out).
 *
 * Note: we don't distinguish "doesn't exist" from "not in your firm" — both are
 * a 404 to the caller, to avoid leaking matter existence via id-guessing.
 */
export async function getMatter(
  userId: string,
  matterId: string,
): Promise<Matter | null> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({
        id: matters.id,
        firmId: matters.firmId,
        userId: matters.userId,
        name: matters.name,
        client: matters.client,
        description: matters.description,
        status: matters.status,
        notes: matters.notes,
        archivedAt: matters.archivedAt,
        aiAccessMode: matters.aiAccessMode,
        aiAccessCommittedAt: matters.aiAccessCommittedAt,
        createdAt: matters.createdAt,
        updatedAt: matters.updatedAt,
      })
      .from(matters)
      .innerJoin(firmMemberships, eq(firmMemberships.firmId, matters.firmId))
      .where(and(eq(matters.id, matterId), eq(firmMemberships.userId, userId)))
      .limit(1),
  );

  return rows[0] ?? null;
}

// =============================================================================
// Create
// =============================================================================

export interface CreateMatterInput {
  /** Required. Defaults to "Untitled case" in the calling server action. */
  name: string;
  /** Optional. */
  client?: string | null;
  /** Optional. */
  description?: string | null;
  /** Defaults to 'active'. */
  status?: MatterStatus;
  /** Optional. */
  notes?: string | null;
  /**
   * Which firm to create the matter in.
   *   - omitted / undefined → the user's PERSONAL firm ("My cases").
   *   - a shared firm id    → that firm ("Firm cases").
   * The caller (server action) decides; the matters page passes a firmId for
   * "Firm cases", and omits it for the default "+ New case" (My cases) flow.
   */
  firmId?: string;
}

/**
 * Creates a new matter and AUTO-ASSIGNS the creator to it (so they can open it
 * immediately). Both the insert and the assignment run in ONE transaction.
 *
 * Firm resolution:
 *   - If input.firmId is provided, the matter is created in that firm. (The
 *     caller is responsible for confirming the user may create there; RLS on
 *     matters_insert also enforces user_id = the caller.)
 *   - If omitted, the matter is created in the user's PERSONAL firm (the
 *     is_personal firm where they are owner). If somehow no personal firm is
 *     found, we throw — a user should always have one post-signup-bootstrap.
 *
 * Returns the inserted matter row (including the newly-generated id).
 */
export async function createMatter(
  userId: string,
  input: CreateMatterInput,
): Promise<Matter> {
  return withUser(userId, async (tx) => {
    // Resolve the target firm.
    let firmId = input.firmId;
    if (!firmId) {
      const personal = await tx
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
        .limit(1);

      firmId = personal[0]?.firmId;
      if (!firmId) {
        throw new Error(
          `createMatter: no personal firm found for user ${userId}`,
        );
      }
    }

    const values: NewMatter = {
      firmId,
      userId,
      name: input.name,
      client: input.client ?? null,
      description: input.description ?? null,
      status: input.status ?? 'active',
      notes: input.notes ?? null,
    };

    const [inserted] = await tx.insert(matters).values(values).returning();

    // Auto-assign the creator so they can immediately open the matter
    // (Ring 2). Uniform-assignment model: every matter, personal or firm, has
    // an assignment row for each user who can open it.
    await tx
      .insert(matterAssignments)
      .values({
        matterId: inserted.id,
        userId,
        assignedBy: userId,
      });

    return inserted;
  });
}

// =============================================================================
// Mutation access guard
// =============================================================================
//
// Every mutation below is gated on ASSIGNMENT (Ring 2): the user may only
// change a matter they're assigned to. We express this as an EXISTS subquery
// against matter_assignments in the UPDATE's WHERE clause, so a non-assigned
// user's update affects zero rows and returns null (the 404-ish signal callers
// already expect). This replaces the old `matters.user_id = userId` guard.

/**
 * Drizzle EXISTS predicate: there is a matter_assignments row linking the
 * given user to the matter being updated.
 */
function assignedToMatter(userId: string) {
  return exists(
    sql`(select 1 from ${matterAssignments} ma
         where ma.matter_id = ${matters.id}
           and ma.user_id = ${userId})`,
  );
}

// =============================================================================
// Update status
// =============================================================================

/**
 * Updates a matter's status (Ring 2 — requires assignment). Bumps updatedAt.
 *
 * Returns the updated row, or null if no matter was updated (doesn't exist, or
 * the user isn't assigned to it). Callers use null as the 404 case.
 *
 * Does NOT un-archive as a side effect (see restoreMatter).
 */
export async function updateMatterStatus(
  userId: string,
  matterId: string,
  status: MatterStatus,
): Promise<Matter | null> {
  const [updated] = await withUser(userId, (tx) =>
    tx
      .update(matters)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(matters.id, matterId), assignedToMatter(userId)))
      .returning(),
  );

  return updated ?? null;
}

// =============================================================================
// Update details (name / client / description)
// =============================================================================

export interface UpdateMatterDetailsInput {
  /** New matter name. Must be non-empty after trimming. */
  name?: string;
  /** New client name. Pass empty string or null to clear. */
  client?: string | null;
  /** New description. Pass empty string or null to clear. */
  description?: string | null;
}

/**
 * Updates a matter's name/client/description (Ring 2 — requires assignment).
 * Pass only the fields to change; omitted fields are untouched.
 *
 * Server-side validation: non-empty name (empty → null/reject), length caps
 * (name 200, client 200, description 2000; longer is silently truncated).
 *
 * Returns the updated row, or null if the matter doesn't exist, the user isn't
 * assigned, or validation rejected. All indistinguishable to the caller.
 */
export async function updateMatterDetails(
  userId: string,
  matterId: string,
  input: UpdateMatterDetailsInput,
): Promise<Matter | null> {
  const updates: Partial<NewMatter> = {};

  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (trimmed.length === 0) {
      return null;
    }
    updates.name = trimmed.slice(0, 200);
  }

  if (input.client !== undefined) {
    if (input.client === null) {
      updates.client = null;
    } else {
      const trimmed = input.client.trim();
      updates.client = trimmed.length === 0 ? null : trimmed.slice(0, 200);
    }
  }

  if (input.description !== undefined) {
    if (input.description === null) {
      updates.description = null;
    } else {
      const trimmed = input.description.trim();
      updates.description = trimmed.length === 0 ? null : trimmed.slice(0, 2000);
    }
  }

  // Nothing to update → return current row without a write.
  if (Object.keys(updates).length === 0) {
    return getMatter(userId, matterId);
  }

  updates.updatedAt = new Date();

  const [updated] = await withUser(userId, (tx) =>
    tx
      .update(matters)
      .set(updates)
      .where(and(eq(matters.id, matterId), assignedToMatter(userId)))
      .returning(),
  );

  return updated ?? null;
}

// =============================================================================
// Archive / restore (soft delete)
// =============================================================================

/**
 * Soft-deletes a matter by setting archived_at = now() (Ring 2 — requires
 * assignment). Returns the updated row, or null (404 case).
 *
 * Conversations and messages are preserved — just hidden from the default
 * list. Hard deletion is intentionally NOT exposed here.
 */
export async function archiveMatter(
  userId: string,
  matterId: string,
): Promise<Matter | null> {
  const [updated] = await withUser(userId, (tx) =>
    tx
      .update(matters)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(matters.id, matterId), assignedToMatter(userId)))
      .returning(),
  );

  return updated ?? null;
}

/**
 * Un-archives a matter — sets archived_at back to NULL (Ring 2 — requires
 * assignment). Returns the updated row, or null (404 case).
 */
export async function restoreMatter(
  userId: string,
  matterId: string,
): Promise<Matter | null> {
  const [updated] = await withUser(userId, (tx) =>
    tx
      .update(matters)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(and(eq(matters.id, matterId), assignedToMatter(userId)))
      .returning(),
  );

  return updated ?? null;
}
