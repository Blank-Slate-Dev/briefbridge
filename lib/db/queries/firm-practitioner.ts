// lib/db/queries/firm-practitioner.ts
//
// Firm-assigned practitioner defaults: what an owner/admin has set for each
// member of a firm.
//
// These are FALLBACKS in the resolution chain (thread > user > firm >
// default) — see lib/practitioner/resolve.ts. Assigning a role to a member
// gives them a sensible starting point without overriding a choice they've
// made for themselves.
//
// SECURITY: writes are gated by RLS on firm_memberships (owner/admin write
// policies from migration 0016) AND by a pre-check in the calling action.

import { and, eq } from 'drizzle-orm';
import { withUser } from '@/lib/db/with-user';
import { firmMemberships } from '@/lib/db/schema';
import type { PractitionerType, PracticeArea } from '@/lib/practitioner/types';

export interface MemberPractitionerAssignment {
  userId: string;
  practitionerType: PractitionerType | null;
  practiceAreas: PracticeArea[];
}

/**
 * Lists the practitioner assignments for every member of a firm. Returned as
 * a plain array so the caller can merge it into the member list by userId.
 */
export async function listFirmPractitionerAssignments(
  callerUserId: string,
  firmId: string,
): Promise<MemberPractitionerAssignment[]> {
  const rows = await withUser(callerUserId, (tx) =>
    tx
      .select({
        userId: firmMemberships.userId,
        practitionerType: firmMemberships.practitionerType,
        practiceAreas: firmMemberships.practiceAreas,
      })
      .from(firmMemberships)
      .where(eq(firmMemberships.firmId, firmId)),
  );

  return rows.map((r) => ({
    userId: r.userId,
    practitionerType: r.practitionerType ?? null,
    practiceAreas: r.practiceAreas ?? [],
  }));
}

/**
 * Sets (or clears) the firm-assigned practitioner defaults for one member.
 * Returns false if no row was updated — which means RLS refused the write
 * (caller isn't an owner/admin of that firm) or the membership doesn't exist.
 */
export async function setMemberPractitionerAssignment(
  callerUserId: string,
  args: {
    firmId: string;
    memberUserId: string;
    practitionerType: PractitionerType | null;
    practiceAreas: PracticeArea[];
  },
): Promise<boolean> {
  const updated = await withUser(callerUserId, (tx) =>
    tx
      .update(firmMemberships)
      .set({
        practitionerType: args.practitionerType,
        practiceAreas: args.practiceAreas,
      })
      .where(
        and(
          eq(firmMemberships.firmId, args.firmId),
          eq(firmMemberships.userId, args.memberUserId),
        ),
      )
      .returning({ id: firmMemberships.id }),
  );

  return updated.length > 0;
}