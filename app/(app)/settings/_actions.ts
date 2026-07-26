// app/(app)/settings/_actions.ts
//
// Server actions for the settings page.
//
// SAME RULE as the other 'use server' modules in this app: async function
// exports ONLY. No type re-exports (Turbopack keeps dangling references and
// they blow up at runtime). Inline the result shape.

'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { updatePractitionerProfile } from '@/lib/db/queries/profile';
import {
  isValidPractitionerType,
  sanitisePracticeAreas,
} from '@/lib/practitioner/types';

type ActionResult = { ok: true } | { ok: false; error: string };

export async function savePractitionerProfileAction(input: {
  practitionerType: string | null;
  practiceAreas: string[];
}): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: 'Not authenticated.' };
  }

  // Validate against the taxonomy. Anything unrecognised is dropped rather
  // than rejected, so a stale client can't hard-fail the save.
  const practitionerType =
    input.practitionerType === null || input.practitionerType === ''
      ? null
      : isValidPractitionerType(input.practitionerType)
        ? input.practitionerType
        : null;

  const practiceAreas = sanitisePracticeAreas(input.practiceAreas);

  const updated = await updatePractitionerProfile(user.id, {
    practitionerType,
    practiceAreas,
  });

  if (!updated) {
    return { ok: false, error: 'Could not save your profile.' };
  }

  // The chat route reads this profile on every message, so bust the app
  // router cache for the workspace.
  revalidatePath('/settings');
  revalidatePath('/chat');

  return { ok: true };
}