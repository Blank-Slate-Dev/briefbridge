// lib/practitioner/resolve.ts
//
// Resolves the EFFECTIVE practitioner profile for a request.
//
// RESOLUTION CHAIN — most specific wins:
//
//   1. Thread override   conversations.practitioner_type / practice_areas
//                        "answer this one thread as a barrister would"
//   2. User setting      profiles.practitioner_type / practice_areas
//                        what the practitioner chose for themselves
//   3. Firm assignment   firm_memberships.practitioner_type / practice_areas
//                        what the firm owner assigned for this member
//   4. Balanced default  nothing set anywhere
//
// The two fields resolve INDEPENDENTLY: a thread can override the role while
// still inheriting the user's practice areas. That's deliberate — "answer this
// as a barrister" shouldn't silently discard someone's practice areas.
//
// NULL vs EMPTY on thread practice areas:
//   null → inherit from the chain
//   []   → explicitly no areas for this thread
// The DB column is nullable precisely so these stay distinguishable.
//
// One query. The chat route runs this inside its existing parallel wave, so
// it costs no extra serial round trip.

import { and, eq, sql } from 'drizzle-orm';
import { withUser } from '@/lib/db/with-user';
import {
  profiles,
  conversations,
  firmMemberships,
  firms,
} from '@/lib/db/schema';
import type { PractitionerType, PracticeArea } from './types';

export interface ResolvedPractitioner {
  type: PractitionerType | null;
  areas: PracticeArea[];
  /** Where the role came from — surfaced in the UI so the user knows why. */
  typeSource: 'thread' | 'user' | 'firm' | 'default';
  /** Where the areas came from. */
  areasSource: 'thread' | 'user' | 'firm' | 'default';
}

export const BALANCED_DEFAULT: ResolvedPractitioner = {
  type: null,
  areas: [],
  typeSource: 'default',
  areasSource: 'default',
};

/**
 * Resolves the effective profile for a user, optionally in the context of a
 * conversation. Never throws — on any failure the caller gets the balanced
 * default, because a personalisation lookup must never break research.
 */
export async function resolvePractitioner(
  userId: string,
  conversationId?: string | null,
): Promise<ResolvedPractitioner> {
  try {
    const rows = await withUser(userId, async (tx) => {
      // Personal setting.
      const [profile] = await tx
        .select({
          practitionerType: profiles.practitionerType,
          practiceAreas: profiles.practiceAreas,
        })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);

      // Firm assignment — from a NON-personal firm membership. A personal
      // firm-of-one is not an employer and must not assign anything.
      const [firmRow] = await tx
        .select({
          practitionerType: firmMemberships.practitionerType,
          practiceAreas: firmMemberships.practiceAreas,
        })
        .from(firmMemberships)
        .innerJoin(firms, eq(firms.id, firmMemberships.firmId))
        .where(
          and(
            eq(firmMemberships.userId, userId),
            eq(firms.isPersonal, false),
            sql`${firmMemberships.practitionerType} is not null
                or array_length(${firmMemberships.practiceAreas}, 1) > 0`,
          ),
        )
        .limit(1);

      // Thread override.
      let threadRow:
        | {
            practitionerType: PractitionerType | null;
            practiceAreas: PracticeArea[] | null;
          }
        | undefined;
      if (conversationId) {
        [threadRow] = await tx
          .select({
            practitionerType: conversations.practitionerType,
            practiceAreas: conversations.practiceAreas,
          })
          .from(conversations)
          .where(
            and(
              eq(conversations.id, conversationId),
              eq(conversations.userId, userId),
            ),
          )
          .limit(1);
      }

      return { profile, firmRow, threadRow };
    });

    const { profile, firmRow, threadRow } = rows;

    // --- Resolve the role ---
    let type: PractitionerType | null = null;
    let typeSource: ResolvedPractitioner['typeSource'] = 'default';
    if (threadRow?.practitionerType) {
      type = threadRow.practitionerType;
      typeSource = 'thread';
    } else if (profile?.practitionerType) {
      type = profile.practitionerType;
      typeSource = 'user';
    } else if (firmRow?.practitionerType) {
      type = firmRow.practitionerType;
      typeSource = 'firm';
    }

    // --- Resolve the areas (independently of the role) ---
    let areas: PracticeArea[] = [];
    let areasSource: ResolvedPractitioner['areasSource'] = 'default';
    if (threadRow && threadRow.practiceAreas !== null) {
      // Non-null (including []) is an explicit thread-level statement.
      areas = threadRow.practiceAreas ?? [];
      areasSource = 'thread';
    } else if (profile?.practiceAreas && profile.practiceAreas.length > 0) {
      areas = profile.practiceAreas;
      areasSource = 'user';
    } else if (firmRow?.practiceAreas && firmRow.practiceAreas.length > 0) {
      areas = firmRow.practiceAreas;
      areasSource = 'firm';
    }

    return { type, areas, typeSource, areasSource };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      '[practitioner] resolve failed, using balanced default:',
      err instanceof Error ? err.message : String(err),
    );
    return BALANCED_DEFAULT;
  }
}