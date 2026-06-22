// app/(app)/_actions/firm.ts
//
// Server actions for firm management (multi-firm collaboration).
//
// FIRST action: "Upgrade to a firm" — creates a NEW SHARED firm with the
// current user as owner (5 seats, trial). The user's PERSONAL firm-of-one is
// left untouched, so their "My cases" stay private; the new shared firm backs
// "Firm cases" and unlocks inviting teammates.
//
// =============================================================================
// IMPORTANT — 'use server' files must export ONLY async functions
// =============================================================================
// Same rule as matters/_actions.ts: Turbopack treats every export here as an
// RPC endpoint. No type re-exports. Inline ActionResult is fine.

'use server';

import { sql } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';

// =============================================================================
// Result type (inline)
// =============================================================================

type ActionResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };

// =============================================================================
// Auth helper — current user's id + email, or an error result
// =============================================================================

async function requireUser(): Promise<
  | { ok: true; userId: string; email: string | null }
  | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: 'Not authenticated.' };
  }
  return { ok: true, userId: user.id, email: user.email ?? null };
}

// =============================================================================
// Upgrade to a firm
// =============================================================================

/**
 * Creates a new SHARED firm (is_personal = false, 5 seats) owned by the current
 * user, via the create_shared_firm SECURITY DEFINER function. The function runs
 * with RLS bypass so it can create the firm + first-owner membership (the user
 * has no role in a firm that doesn't exist yet) — same bootstrap pattern as the
 * signup trigger.
 *
 * The firm name defaults to a value derived from the user's email local-part
 * (e.g. "oakley@..." -> "Oakley's Firm"). The user can rename it later via firm
 * settings (not yet built).
 *
 * Returns the new firm id on success so the caller can refresh / navigate.
 *
 * NOTE: we pass the AUTHENTICATED user's id to the function. Only briefbridge_app
 * may execute it, and we never pass anything but the verified id, so a user can't
 * create a firm owned by someone else.
 */
export async function upgradeToFirmAction(): Promise<ActionResult<{ firmId: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  // Default firm name from the email local-part, e.g. "Oakley's Firm".
  const localPart =
    auth.email && auth.email.includes('@')
      ? auth.email.split('@')[0]
      : '';
  const defaultName =
    localPart.length > 0
      ? `${localPart.charAt(0).toUpperCase()}${localPart.slice(1)}'s Firm`
      : 'My Firm';

  try {
    const rows = await db.execute<{ create_shared_firm: string }>(
      sql`select create_shared_firm(${auth.userId}::uuid, ${defaultName}::text) as create_shared_firm`,
    );

    // postgres-js returns an array-like of result rows. Pull the returned id.
    const firmId =
      Array.isArray(rows) && rows.length > 0
        ? (rows[0] as { create_shared_firm: string }).create_shared_firm
        : undefined;

    if (!firmId) {
      return { ok: false, error: 'Could not create firm.' };
    }

    return { ok: true, data: { firmId } };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('upgradeToFirmAction failed:', err);
    return { ok: false, error: 'Could not create firm. Please try again.' };
  }
}