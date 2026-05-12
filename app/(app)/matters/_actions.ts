// app/(app)/matters/_actions.ts
//
// Server actions for the matters domain.
//
// These are invoked from Client Components (the MattersProvider and the
// "+ New case" button) via direct function call — Next.js handles the
// RPC boundary automatically when a server action is imported into a
// Client Component file.
//
// All actions authenticate via the Supabase server client and bail out
// with an `{ ok: false, error }` shape if the user isn't signed in.
// Middleware should already have redirected unauthenticated users away
// from /matters before these are reachable, but defense in depth costs
// nothing.
//
// =============================================================================
// IMPORTANT — Files with 'use server' must export ONLY async functions
// =============================================================================
//
// Next 16's Turbopack server-actions compiler treats every export in a
// 'use server' module as an RPC endpoint. Type-only exports (e.g.
// `export type { Foo };`) are a Bad Idea here even though TypeScript
// strips them at emit time — Turbopack's compilation passes can retain
// dangling identifier references, leading to runtime `ReferenceError: Foo
// is not defined` when the actions module loads.
//
// Rule: in this file, ONLY export async functions. Types belong in
// lib/db/schema.ts (or wherever else they live); import them where needed.
// Inline type aliases like ActionResult below are fine because they have
// no source-side identifier import.

'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import {
  createMatter,
  updateMatterStatus,
  updateMatterDetails,
  archiveMatter,
  type MatterStatus,
} from '@/lib/db/queries/matters';

// =============================================================================
// Result types (inline — no external type imports re-exported)
// =============================================================================

type ActionResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };

// =============================================================================
// Auth helper — pulls the current user or returns an error result
// =============================================================================

async function requireUser(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: 'Not authenticated.' };
  }
  return { ok: true, userId: user.id };
}

// =============================================================================
// Create matter (quick-create flow)
// =============================================================================

/**
 * Creates a new "Untitled case" matter for the current user and redirects
 * to its detail page.
 *
 * The redirect target carries `?new=1` so the detail page knows to auto-
 * focus the name input on first render (so the user can immediately rename
 * the placeholder "Untitled case" without first clicking the title). The
 * detail page strips the `?new=1` from the URL via history.replaceState
 * once it's done focusing, so a refresh doesn't re-trigger the focus.
 *
 * NOTE: redirect() throws a special error that Next.js catches to perform
 * the redirect. It must NOT be wrapped in try/catch — if you do, you'll
 * accidentally swallow the redirect and the user will stay on the matters
 * list with a fresh "Untitled case" stranded in the DB.
 */
export async function createNewMatterAction(): Promise<never> {
  const auth = await requireUser();
  if (!auth.ok) {
    // Redirect to login rather than returning an error — there's no UI
    // path here to display one. The middleware should have caught this
    // already; if we're here, something has gone subtly wrong.
    redirect('/login');
  }

  const matter = await createMatter(auth.userId, {
    name: 'Untitled case',
    status: 'active',
  });

  // Redirect to the matter detail page with the `?new=1` hint.
  redirect(`/matters/${matter.id}?new=1`);
}

// =============================================================================
// Update status
// =============================================================================

export async function updateMatterStatusAction(
  matterId: string,
  status: MatterStatus,
): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  // Validate status against the allowed set. This protects against a
  // malformed client call; the DB CHECK constraint is the ultimate gate
  // but we want a friendly error message before that.
  const VALID_STATUSES: MatterStatus[] = [
    'active',
    'on-hold',
    'awaiting-client',
    'in-hearing',
    'settled',
    'closed',
  ];
  if (!VALID_STATUSES.includes(status)) {
    return { ok: false, error: `Invalid status: ${status}` };
  }

  const updated = await updateMatterStatus(auth.userId, matterId, status);
  if (!updated) {
    // The matter doesn't exist or isn't owned by this user. Either way,
    // we don't tell the client which.
    return { ok: false, error: 'Matter not found.' };
  }

  return { ok: true };
}

// =============================================================================
// Update details (name / client / description) — Chunk 4
// =============================================================================
//
// Called from the inline-edit fields on the matter detail page header.
// Pass only the fields that changed. The provider's optimistic-update
// pattern handles client-side rollback if this returns { ok: false }.
//
// Validation matches what the DB query does, with friendly error messages:
//   - name: required, non-empty after trim, max 200 chars
//   - client: optional, max 200 chars, null/empty clears it
//   - description: optional, max 2000 chars, null/empty clears it
//
// Length caps in this action are advisory — the query layer silently
// truncates to the cap if exceeded. The action validates lengths so the
// client gets a clear error message rather than mysterious truncation.

export async function updateMatterDetailsAction(
  matterId: string,
  fields: {
    name?: string;
    client?: string | null;
    description?: string | null;
  },
): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  // Validate name if provided.
  if (fields.name !== undefined) {
    const trimmed = fields.name.trim();
    if (trimmed.length === 0) {
      return { ok: false, error: 'Name cannot be empty.' };
    }
    if (trimmed.length > 200) {
      return { ok: false, error: 'Name is too long (max 200 characters).' };
    }
  }

  // Validate client length if provided.
  if (typeof fields.client === 'string' && fields.client.trim().length > 200) {
    return { ok: false, error: 'Client name is too long (max 200 characters).' };
  }

  // Validate description length if provided.
  if (
    typeof fields.description === 'string' &&
    fields.description.trim().length > 2000
  ) {
    return {
      ok: false,
      error: 'Description is too long (max 2000 characters).',
    };
  }

  const updated = await updateMatterDetails(auth.userId, matterId, fields);
  if (!updated) {
    // Either the matter doesn't exist / isn't ours, or server-side
    // validation rejected (e.g. empty name). Don't distinguish.
    return { ok: false, error: 'Could not update matter.' };
  }

  return { ok: true };
}

// =============================================================================
// Archive matter
// =============================================================================

export async function archiveMatterAction(
  matterId: string,
): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  const archived = await archiveMatter(auth.userId, matterId);
  if (!archived) {
    return { ok: false, error: 'Matter not found.' };
  }

  return { ok: true };
}

// If you need future server actions that operate on Matter rows, import
// `Matter` from '@/lib/db/schema' INSIDE the function body or use it only
// as a parameter/return type. Do NOT re-export types from this file.
