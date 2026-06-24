// lib/db/queries/firm-invitations.ts
//
// Query helpers for firm_invitations (member-invite flow).
//
// Access model:
//   - create / list / revoke run through withUser(), so the RLS policies from
//     migration 0018 enforce that only an owner/admin of the inviting firm can
//     do them (current_firm_role gate). The TS layer doesn't re-check role —
//     RLS is the gate. A non-admin's insert/select/delete simply affects zero
//     rows / returns nothing.
//   - accept is different: the accepting user has NO role in the firm yet, so
//     it can't go through the firm-scoped policies. It calls the
//     accept_firm_invitation SECURITY DEFINER function (validates token +
//     email, inserts membership, marks accepted) — same bootstrap pattern as
//     create_shared_firm.
//
// Token: crypto.randomUUID() — unguessable enough for an invite link, no dep.

import { randomUUID } from 'crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { withUser } from '@/lib/db/with-user';
import {
  firmInvitations,
  firmMemberships,
  type FirmInvitation,
  type FirmRole,
} from '@/lib/db/schema';

// Roles an invite may grant. NOT 'owner' (one owner per firm = creator). This
// mirrors the CHECK constraint on the table.
export type InvitableRole = Extract<FirmRole, 'admin' | 'lawyer' | 'paralegal'>;

// =============================================================================
// Create
// =============================================================================

export interface CreateInvitationInput {
  firmId: string;
  email: string;
  role: InvitableRole;
}

/**
 * Creates a pending invitation and returns it (including the generated token).
 *
 * RLS (firm_invitations_insert_admin) enforces the caller is owner/admin of
 * firmId. If they're not, the insert is rejected by the policy (the caller
 * sees an error). The partial-unique index rejects a second PENDING invite for
 * the same (firm, email) — caller should surface "already invited".
 *
 * The email is stored as given but matched case-insensitively elsewhere.
 */
export async function createInvitation(
  userId: string,
  input: CreateInvitationInput,
): Promise<FirmInvitation> {
  const token = randomUUID();

  // 14-day expiry, set explicitly in TS. The DB column also has a 14-day
  // default, but Drizzle requires the value at insert time (the column is
  // NOT NULL with no Drizzle-side default), so we set it here.
  const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

  const [inserted] = await withUser(userId, (tx) =>
    tx
      .insert(firmInvitations)
      .values({
        firmId: input.firmId,
        email: input.email.trim(),
        role: input.role,
        token,
        invitedBy: userId,
        expiresAt,
      })
      .returning(),
  );

  return inserted;
}

// =============================================================================
// List (for a firm)
// =============================================================================

/**
 * Lists invitations for a firm, most-recent first. RLS
 * (firm_invitations_select_admin) means only an owner/admin of the firm gets
 * rows back; anyone else gets an empty list.
 *
 * By default returns only 'pending' invites (the actionable ones for the
 * members screen). Pass includeAll to get every status.
 */
export async function listFirmInvitations(
  userId: string,
  firmId: string,
  options: { includeAll?: boolean } = {},
): Promise<FirmInvitation[]> {
  const conditions = [eq(firmInvitations.firmId, firmId)];
  if (!options.includeAll) {
    conditions.push(eq(firmInvitations.status, 'pending'));
  }

  return withUser(userId, (tx) =>
    tx
      .select()
      .from(firmInvitations)
      .where(and(...conditions))
      .orderBy(desc(firmInvitations.createdAt)),
  );
}

// =============================================================================
// Revoke
// =============================================================================

/**
 * Revokes a pending invitation (sets status = 'revoked'). RLS
 * (firm_invitations_update_admin) enforces the caller is owner/admin of the
 * invite's firm. Returns the updated row, or null if nothing was updated
 * (wrong id, not pending, or not permitted — indistinguishable to the caller).
 */
export async function revokeInvitation(
  userId: string,
  invitationId: string,
): Promise<FirmInvitation | null> {
  const [updated] = await withUser(userId, (tx) =>
    tx
      .update(firmInvitations)
      .set({ status: 'revoked' })
      .where(
        and(
          eq(firmInvitations.id, invitationId),
          eq(firmInvitations.status, 'pending'),
        ),
      )
      .returning(),
  );

  return updated ?? null;
}

// =============================================================================
// Get by token (for the accept screen — show firm/role before accepting)
// =============================================================================

/**
 * Looks up an invitation by token. Used by the accept screen to show "You've
 * been invited to <firm> as <role>" before the user accepts.
 *
 * Runs through withUser so the self-lookup policy (firm_invitations_select_own,
 * matched on the caller's email) applies. NOTE: this means the signed-in user
 * can only read the invite if its email matches theirs — which is exactly the
 * invariant we want for the in-app accept path. Returns null if not found / not
 * theirs.
 */
export async function getInvitationByToken(
  userId: string,
  token: string,
): Promise<FirmInvitation | null> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select()
      .from(firmInvitations)
      .where(eq(firmInvitations.token, token))
      .limit(1),
  );

  return rows[0] ?? null;
}

// =============================================================================
// Accept (privileged — SECURITY DEFINER function)
// =============================================================================

export type AcceptInvitationResult =
  | { ok: true; firmId: string }
  | {
      ok: false;
      reason: 'not_found' | 'expired' | 'email_mismatch' | 'error';
    };

/**
 * Accepts an invitation by token for the given user. Calls the
 * accept_firm_invitation SECURITY DEFINER function, which validates the token
 * is pending + unexpired + the email matches the accepting user, inserts the
 * firm_memberships row (idempotent), and marks the invite accepted. Returns the
 * firm id on success.
 *
 * MULTI-FIRM: accepting just ADDS a membership — the user keeps their personal
 * firm and any other firms. No bootstrap-skipping, no data collision.
 *
 * The function raises specific exceptions we map to reasons for the caller.
 */
export async function acceptInvitation(
  userId: string,
  userEmail: string,
  token: string,
): Promise<AcceptInvitationResult> {
  try {
    const rows = await db.execute<{ accept_firm_invitation: string }>(
      sql`select accept_firm_invitation(${userId}::uuid, ${userEmail}::text, ${token}::text) as accept_firm_invitation`,
    );

    const firmId =
      Array.isArray(rows) && rows.length > 0
        ? (rows[0] as { accept_firm_invitation: string }).accept_firm_invitation
        : undefined;

    if (!firmId) {
      return { ok: false, reason: 'error' };
    }
    return { ok: true, firmId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('invite_not_found')) {
      return { ok: false, reason: 'not_found' };
    }
    if (message.includes('invite_expired')) {
      return { ok: false, reason: 'expired' };
    }
    if (message.includes('invite_email_mismatch')) {
      return { ok: false, reason: 'email_mismatch' };
    }
    // eslint-disable-next-line no-console
    console.error('acceptInvitation failed:', message);
    return { ok: false, reason: 'error' };
  }
}

// =============================================================================
// List firm members (with name + email)
// =============================================================================

export interface FirmMemberRow {
  userId: string;
  email: string;
  fullName: string | null;
  role: FirmRole;
  createdAt: Date;
}

/**
 * Lists the members of a firm with their email + name, via the
 * list_firm_members SECURITY DEFINER function (which reads auth.users).
 *
 * SECURITY: the function itself does NOT verify the caller is a member of the
 * firm — that check MUST happen in the calling action (verify membership before
 * calling this). We pass the firmId the action has already authorised.
 */
export async function listFirmMembers(firmId: string): Promise<FirmMemberRow[]> {
  const rows = await db.execute<{
    user_id: string;
    email: string;
    full_name: string | null;
    role: FirmRole;
    created_at: string | Date;
  }>(sql`select * from list_firm_members(${firmId}::uuid)`);

  const list = Array.isArray(rows) ? rows : [];
  return list.map((r) => ({
    userId: r.user_id,
    email: r.email,
    fullName: r.full_name,
    role: r.role,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
  }));
}

/**
 * Returns true if the user is a member of the firm. Used by actions to
 * authorise firm-scoped reads (e.g. listing members) before calling
 * definer functions that don't self-check.
 */
export async function isFirmMember(
  userId: string,
  firmId: string,
): Promise<boolean> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({ firmId: firmMemberships.firmId })
      .from(firmMemberships)
      .where(
        and(
          eq(firmMemberships.firmId, firmId),
          eq(firmMemberships.userId, userId),
        ),
      )
      .limit(1),
  );
  return rows.length > 0;
}

// =============================================================================
// Get invitation for the accept screen (firm name + validity)
// =============================================================================

export interface InvitationForAccept {
  firmId: string;
  firmName: string;
  role: FirmRole;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expired: boolean;
  emailMatches: boolean;
}

/**
 * Returns the invite details + firm name for the accept screen, via the
 * get_invitation_for_accept SECURITY DEFINER function (which can read the firm
 * name even though the accepting user isn't a member yet). Returns null if the
 * token doesn't exist.
 */
export async function getInvitationForAccept(
  token: string,
  userEmail: string,
): Promise<InvitationForAccept | null> {
  const rows = await db.execute<{
    firm_id: string;
    firm_name: string;
    role: FirmRole;
    status: 'pending' | 'accepted' | 'revoked' | 'expired';
    expired: boolean;
    email_matches: boolean;
  }>(
    sql`select * from get_invitation_for_accept(${token}::text, ${userEmail}::text)`,
  );

  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return null;
  const r = list[0];
  return {
    firmId: r.firm_id,
    firmName: r.firm_name,
    role: r.role,
    status: r.status,
    expired: r.expired,
    emailMatches: r.email_matches,
  };
}