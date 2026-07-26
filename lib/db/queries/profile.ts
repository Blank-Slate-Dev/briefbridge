// lib/db/queries/profile.ts
//
// Read/write helpers for the user's own profile row.
//
// Scope: a user only ever reads and writes THEIR OWN profile (id = auth uid),
// so every function takes userId and constrains on it. Runs through withUser
// so RLS sees the identity, consistent with the rest of the query layer.

import { eq } from 'drizzle-orm';
import { withUser } from '@/lib/db/with-user';
import { profiles, type Profile } from '@/lib/db/schema';
import type {
  PractitionerType,
  PracticeArea,
} from '@/lib/practitioner/types';

export interface PractitionerProfile {
  practitionerType: PractitionerType | null;
  practiceAreas: PracticeArea[];
  fullName: string | null;
  firmName: string | null;
}

/**
 * Returns the user's practitioner profile, or sensible empty defaults if no
 * profile row exists yet (a user created before the profiles trigger, or a
 * row that hasn't been written).
 */
export async function getPractitionerProfile(
  userId: string,
): Promise<PractitionerProfile> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({
        practitionerType: profiles.practitionerType,
        practiceAreas: profiles.practiceAreas,
        fullName: profiles.fullName,
        firmName: profiles.firmName,
      })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1),
  );

  const row = rows[0];
  if (!row) {
    return {
      practitionerType: null,
      practiceAreas: [],
      fullName: null,
      firmName: null,
    };
  }
  return {
    practitionerType: row.practitionerType ?? null,
    practiceAreas: row.practiceAreas ?? [],
    fullName: row.fullName,
    firmName: row.firmName,
  };
}

/**
 * Upserts the practitioner fields. Uses INSERT ... ON CONFLICT so it works
 * whether or not a profile row already exists (some accounts predate the
 * signup trigger).
 *
 * Callers MUST validate/sanitise inputs first — see
 * isValidPractitionerType / sanitisePracticeAreas in lib/practitioner/types.
 */
export async function updatePractitionerProfile(
  userId: string,
  input: {
    practitionerType: PractitionerType | null;
    practiceAreas: PracticeArea[];
  },
): Promise<Profile | null> {
  const [row] = await withUser(userId, (tx) =>
    tx
      .insert(profiles)
      .values({
        id: userId,
        practitionerType: input.practitionerType,
        practiceAreas: input.practiceAreas,
      })
      .onConflictDoUpdate({
        target: profiles.id,
        set: {
          practitionerType: input.practitionerType,
          practiceAreas: input.practiceAreas,
          updatedAt: new Date(),
        },
      })
      .returning(),
  );

  return row ?? null;
}