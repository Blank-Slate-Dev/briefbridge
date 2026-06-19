// lib/db/queries/matters.ts
//
// Query helpers for the `matters` table.
//
// CRITICAL: every query in this file applies `where(eq(matters.userId, userId))`.
// This is the FIRST line of defense — RLS is the second. If you forget the
// filter, RLS still saves us as long as the query runs as the auth role,
// but Drizzle connects as the postgres role (bypassing RLS), so the filter
// is what actually protects user data day-to-day.
//
// All functions take `userId` as the first argument to make this impossible
// to forget. If you ever find yourself wanting a "list all matters across
// all users" function, that's an admin tool and belongs in a separate file
// with explicit "this bypasses user scoping" comments.

import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { withUser } from '@/lib/db/with-user';
import {
  matters,
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
 * Returns all of the user's matters, ordered by most-recently-updated first.
 *
 * By default, archived matters (archived_at IS NOT NULL) are excluded.
 * Pass `{ includeArchived: true }` to include them (e.g. for an "Archived"
 * tab in the UI down the road).
 */
export async function listMattersForUser(
  userId: string,
  options: ListMattersOptions = {},
): Promise<Matter[]> {
  const conditions = [eq(matters.userId, userId)];
  if (!options.includeArchived) {
    conditions.push(isNull(matters.archivedAt));
  }

  return db
    .select()
    .from(matters)
    .where(and(...conditions))
    .orderBy(desc(matters.updatedAt));
}

// =============================================================================
// Get one
// =============================================================================

/**
 * Returns a single matter by id, IF it belongs to the given user.
 * Returns null if the matter doesn't exist OR isn't owned by this user.
 *
 * Note: we don't distinguish "doesn't exist" from "not yours" in the return
 * value. This is deliberate — leaking that distinction lets an attacker
 * probe for the existence of other users' matters by id-guessing. From the
 * caller's perspective, both cases are "404".
 */
export async function getMatter(
  userId: string,
  matterId: string,
): Promise<Matter | null> {
  // STEP 4 (RLS Path A): run inside withUser so app.user_id is set for the
  // query's transaction. Today (bypass connection) this is behaviourally
  // identical to a bare db query; after the connection cutover, RLS enforces
  // the same access this function's where-clause already enforces.
  // Note: use `tx` inside the callback, NOT `db`.
  const rows = await withUser(userId, (tx) =>
    tx
      .select()
      .from(matters)
      .where(and(eq(matters.id, matterId), eq(matters.userId, userId)))
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
}

/**
 * Creates a new matter for the given user.
 *
 * Returns the inserted row (including the newly-generated id).
 *
 * The CHECK constraint at the DB level will reject statuses outside the
 * 6 allowed values; the TS type makes that hard to hit by accident.
 */
export async function createMatter(
  userId: string,
  input: CreateMatterInput,
): Promise<Matter> {
  const values: NewMatter = {
    userId,
    name: input.name,
    client: input.client ?? null,
    description: input.description ?? null,
    status: input.status ?? 'active',
    notes: input.notes ?? null,
  };

  const [inserted] = await db.insert(matters).values(values).returning();
  return inserted;
}

// =============================================================================
// Update status
// =============================================================================

/**
 * Updates a matter's status. Also bumps updatedAt.
 *
 * Returns the updated row, or null if no matter was updated (because the
 * matter doesn't exist or isn't owned by this user). Callers can use that
 * to detect a 404 case.
 *
 * Note: this does NOT un-archive a matter as a side effect. If a matter is
 * archived (archived_at IS NOT NULL), the status update still applies, but
 * the matter remains hidden from the default list. Use restoreMatter() to
 * unarchive.
 */
export async function updateMatterStatus(
  userId: string,
  matterId: string,
  status: MatterStatus,
): Promise<Matter | null> {
  const [updated] = await db
    .update(matters)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(matters.id, matterId), eq(matters.userId, userId)))
    .returning();

  return updated ?? null;
}

// =============================================================================
// Update details (name / client / description)
// =============================================================================
//
// Added in Chunk 4 for inline editing. Each field is optional — pass only
// the fields you want to change. Caller is responsible for client-side
// validation (non-empty name, length caps); we do the bare-minimum
// server-side guarding here too as a safety net.

export interface UpdateMatterDetailsInput {
  /** New matter name. Must be non-empty after trimming. */
  name?: string;
  /** New client name. Pass empty string or null to clear. */
  client?: string | null;
  /** New description. Pass empty string or null to clear. */
  description?: string | null;
}

/**
 * Updates a matter's name, client, and/or description. Pass only the fields
 * to change; omitted fields are left untouched.
 *
 * Server-side validation:
 *   - If `name` is provided, it must be non-empty after trimming. Empty names
 *     return null (caller treats as "operation rejected").
 *   - Length caps: name 200, client 200, description 2000. Anything longer
 *     gets trimmed to the cap (we don't error — the client should have
 *     prevented it, but if it didn't, silently truncating is friendlier
 *     than rejecting after the user has already typed).
 *
 * Returns the updated row, or null if:
 *   - The matter doesn't exist OR isn't owned by this user (404 case), OR
 *   - The input failed server-side validation (e.g. empty name after trim).
 *
 * Both are intentionally indistinguishable from the caller's perspective
 * for the same reason as getMatter() — don't leak whether a matter exists.
 */
export async function updateMatterDetails(
  userId: string,
  matterId: string,
  input: UpdateMatterDetailsInput,
): Promise<Matter | null> {
  // Build the update payload from only the provided fields.
  // We use a Partial of the column shape so unset fields stay untouched.
  const updates: Partial<NewMatter> = {};

  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (trimmed.length === 0) {
      // Reject empty name — return null so caller can handle as 404-ish.
      // (Client-side validation should have caught this; this is the
      // server-side backstop.)
      return null;
    }
    updates.name = trimmed.slice(0, 200);
  }

  if (input.client !== undefined) {
    // null or empty-after-trim both clear the field. Otherwise cap at 200.
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

  // If nothing actually needs updating (caller passed an empty object),
  // return the current row without touching the DB. Saves a write +
  // updatedAt bump that would otherwise change sort order unnecessarily.
  if (Object.keys(updates).length === 0) {
    return getMatter(userId, matterId);
  }

  updates.updatedAt = new Date();

  const [updated] = await db
    .update(matters)
    .set(updates)
    .where(and(eq(matters.id, matterId), eq(matters.userId, userId)))
    .returning();

  return updated ?? null;
}

// =============================================================================
// Archive / restore (soft delete)
// =============================================================================

/**
 * Soft-deletes a matter by setting archived_at = now().
 *
 * Returns the updated row, or null if no matter was archived (404 case).
 *
 * The matter is preserved in the DB along with all its conversations and
 * messages — they're just hidden from the default list. This is the
 * legally-appropriate behaviour for a research tool: lawyers should be
 * able to recover work product even after they've "deleted" it.
 *
 * Hard deletion is intentionally NOT exposed as a function here. If we ever
 * need a "permanently delete" feature, add it explicitly and document it.
 */
export async function archiveMatter(
  userId: string,
  matterId: string,
): Promise<Matter | null> {
  const [updated] = await db
    .update(matters)
    .set({ archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(matters.id, matterId), eq(matters.userId, userId)))
    .returning();

  return updated ?? null;
}

/**
 * Un-archives a matter — sets archived_at back to NULL.
 *
 * Returns the updated row, or null if no matter was restored (404 case).
 */
export async function restoreMatter(
  userId: string,
  matterId: string,
): Promise<Matter | null> {
  const [updated] = await db
    .update(matters)
    .set({ archivedAt: null, updatedAt: new Date() })
    .where(and(eq(matters.id, matterId), eq(matters.userId, userId)))
    .returning();

  return updated ?? null;
}
