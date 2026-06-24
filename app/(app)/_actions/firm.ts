// app/(app)/_actions/firm.ts
//
// Server actions for firm management (multi-firm collaboration).
//
//   - upgradeToFirmAction   — create a shared firm owned by the user.
//   - createInvitationAction— invite someone (email + role); sends an email.
//   - revokeInvitationAction— revoke a pending invite.
//   - listFirmDataAction    — re-fetch members + pending invites (for the
//                             client to refresh after a change).
//
// =============================================================================
// IMPORTANT — 'use server' files must export ONLY async functions
// =============================================================================
// Turbopack treats every export here as an RPC endpoint. No type re-exports.
// Inline ActionResult is fine.

'use server';

import { sql, eq } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { db } from '@/lib/db';
import { withUser } from '@/lib/db/with-user';
import { firms } from '@/lib/db/schema';
import {
  createInvitation,
  revokeInvitation,
  listFirmInvitations,
  listFirmMembers,
  isFirmMember,
  type InvitableRole,
  type FirmMemberRow,
} from '@/lib/db/queries/firm-invitations';
import type { FirmInvitation } from '@/lib/db/schema';
import { sendInviteEmail } from '@/lib/email/send-invite';

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
  | { ok: true; userId: string; email: string | null; displayName: string | null }
  | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: 'Not authenticated.' };
  }
  const displayName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    null;
  return {
    ok: true,
    userId: user.id,
    email: user.email ?? null,
    displayName,
  };
}

// Roles an invite may grant (mirrors the DB CHECK + InvitableRole).
const VALID_INVITE_ROLES: InvitableRole[] = ['admin', 'lawyer', 'paralegal'];

// Minimal email sanity check (not full RFC — just a guard for obvious typos).
function looksLikeEmail(value: string): boolean {
  const v = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

// Base URL for building invite links. Set NEXT_PUBLIC_APP_URL in the
// environment (e.g. http://localhost:3000 locally, the real URL in prod).
function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'http://localhost:3000';
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

// =============================================================================
// Create invitation
// =============================================================================

/**
 * Invites someone to a firm by email + role. Creates the invite, then sends an
 * invitation email with the accept link. Returns the created invitation
 * (including its token, so the UI can also show a copyable link).
 *
 * Authorisation: we pre-check the caller is a MEMBER of the firm (friendly
 * error if not). The real gate is RLS — firm_invitations_insert_admin only
 * permits owner/admin of the firm, so a mere member (lawyer/paralegal) trying
 * to invite is rejected at the DB layer and surfaces as an error here.
 *
 * Email: sent via sendInviteEmail, which NEVER throws — a failed email doesn't
 * fail the invite (the link is still copyable in the UI). We log email failures.
 */
export async function createInvitationAction(
  firmId: string,
  email: string,
  role: InvitableRole,
): Promise<ActionResult<{ invitation: FirmInvitation }>> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  const cleanEmail = email.trim();
  if (!looksLikeEmail(cleanEmail)) {
    return { ok: false, error: 'Please enter a valid email address.' };
  }
  if (!VALID_INVITE_ROLES.includes(role)) {
    return { ok: false, error: `Invalid role: ${role}` };
  }

  // Friendly pre-check (RLS is the real gate on admin-ness).
  const member = await isFirmMember(auth.userId, firmId);
  if (!member) {
    return { ok: false, error: 'You are not a member of this firm.' };
  }

  let invitation: FirmInvitation;
  try {
    invitation = await createInvitation(auth.userId, {
      firmId,
      email: cleanEmail,
      role,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Partial-unique index violation = duplicate pending invite.
    if (
      message.includes('firm_invitations_one_pending_per_email') ||
      message.includes('duplicate key')
    ) {
      return {
        ok: false,
        error: 'That email already has a pending invitation to this firm.',
      };
    }
    // RLS denial (not owner/admin) surfaces as a generic insert error.
    // eslint-disable-next-line no-console
    console.error('createInvitationAction failed:', message);
    return {
      ok: false,
      error:
        'Could not create the invitation. Only firm owners and admins can invite.',
    };
  }

  // Invite created. Now send the email (best-effort — never blocks success).
  try {
    // Look up the firm name for the email (through withUser so the firms RLS
    // policy has app.user_id set).
    const firmRows = await withUser(auth.userId, (tx) =>
      tx
        .select({ name: firms.name })
        .from(firms)
        .where(eq(firms.id, firmId))
        .limit(1),
    );
    const firmName = firmRows[0]?.name ?? 'a firm';

    const inviteLink = `${appBaseUrl()}/invite/${invitation.token}`;

    await sendInviteEmail({
      to: cleanEmail,
      firmName,
      role,
      inviteLink,
      inviterName: auth.displayName,
    });
  } catch (err) {
    // Email failure must not fail the invite — the link is copyable in the UI.
    // eslint-disable-next-line no-console
    console.error('createInvitationAction: email send failed:', err);
  }

  return { ok: true, data: { invitation } };
}

// =============================================================================
// Revoke invitation
// =============================================================================

/**
 * Revokes a pending invitation. RLS (firm_invitations_update_admin) enforces
 * the caller is owner/admin of the invite's firm. Returns ok even if nothing
 * was revoked (idempotent from the caller's view) — but reports an error if the
 * row genuinely couldn't be updated.
 */
export async function revokeInvitationAction(
  invitationId: string,
): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  try {
    const revoked = await revokeInvitation(auth.userId, invitationId);
    if (!revoked) {
      return { ok: false, error: 'Could not revoke the invitation.' };
    }
    return { ok: true };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('revokeInvitationAction failed:', err);
    return { ok: false, error: 'Could not revoke the invitation.' };
  }
}

// =============================================================================
// List firm data (members + pending invites) — for client refresh
// =============================================================================

/**
 * Returns the firm's members + pending invitations, for the client to refresh
 * after creating/revoking an invite. Pre-checks the caller is a member of the
 * firm. (listFirmMembers reads via a definer function that doesn't self-check,
 * so this membership gate matters.)
 */
export async function listFirmDataAction(
  firmId: string,
): Promise<
  ActionResult<{ members: FirmMemberRow[]; invitations: FirmInvitation[] }>
> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  const member = await isFirmMember(auth.userId, firmId);
  if (!member) {
    return { ok: false, error: 'You are not a member of this firm.' };
  }

  try {
    const [members, invitations] = await Promise.all([
      listFirmMembers(firmId),
      listFirmInvitations(auth.userId, firmId),
    ]);
    return { ok: true, data: { members, invitations } };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('listFirmDataAction failed:', err);
    return { ok: false, error: 'Could not load firm data.' };
  }
}