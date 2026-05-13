// app/(app)/matters/[id]/files/_actions-ai.ts
//
// CHUNK 7 server actions. Kept SEPARATE from _actions.ts (Chunk 6's
// upload/delete/tag actions) so the file doesn't grow unwieldy and so
// the Chunk 6 file remains stable.
//
// SAME RULE as Chunk 6's _actions.ts: async-function exports only.
// No type re-exports. Inline ActionResult shapes.

'use server';

import { createClient } from '@/lib/supabase/server';
import {
  getAiAccessState,
  updateAiAccess,
  setFileAiBlock,
  type AiAccessState,
} from '@/lib/db/queries/ai-access';
import { getFile } from '@/lib/db/queries/files';
import { deleteAnthropicCopy } from '@/lib/anthropic/file-sync';
import { isValidAiAccessMode, type AiAccessMode } from '@/lib/files/ai-access-types';

// =============================================================================
// Result types — local to this file
// =============================================================================

type ActionResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };

// =============================================================================
// Auth helper (duplicated; small enough)
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
// getAiAccessAction — used by the FilesProvider on initial mount and after
// state-affecting actions
// =============================================================================

export async function getAiAccessAction(args: {
  matterId: string;
}): Promise<ActionResult<{ state: AiAccessState }>> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  const state = await getAiAccessState(auth.userId, args.matterId);
  if (!state) {
    return { ok: false, error: 'Matter not found.' };
  }
  return { ok: true, data: { state } };
}

// =============================================================================
// updateAiAccessAction — the Confirm button in the AI access panel
// =============================================================================

export async function updateAiAccessAction(args: {
  matterId: string;
  mode: AiAccessMode;
  excludedFileIds: string[];
}): Promise<ActionResult<{ state: AiAccessState }>> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  // Validate mode.
  if (!isValidAiAccessMode(args.mode)) {
    return { ok: false, error: 'Invalid access mode.' };
  }

  // Defensive: cap excludedFileIds size. No legitimate matter has more
  // than a few hundred files, but a malformed client could pile in a
  // huge array.
  if (args.excludedFileIds.length > 1000) {
    return {
      ok: false,
      error: 'Too many files in the exclusion list.',
    };
  }

  const state = await updateAiAccess(auth.userId, args.matterId, {
    mode: args.mode,
    excludedFileIds: args.excludedFileIds,
  });

  if (!state) {
    return { ok: false, error: 'Matter not found.' };
  }
  return { ok: true, data: { state } };
}

// =============================================================================
// setFileAiBlockAction — kebab menu "Block Claude from reading"
// =============================================================================
//
// When blocking, we ALSO delete the Anthropic-side copy (if any). This
// is the privilege-revocation pathway. When unblocking, we just clear
// the flag — the Anthropic copy will be re-created on next read.

export async function setFileAiBlockAction(args: {
  fileId: string;
  blocked: boolean;
}): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  // Set the flag.
  const result = await setFileAiBlock(auth.userId, args.fileId, args.blocked);
  if (!result.ok) {
    return { ok: false, error: 'File not found.' };
  }

  // If blocking, also delete the Anthropic copy if present.
  if (args.blocked) {
    const file = await getFile(auth.userId, args.fileId);
    if (file?.anthropicFileId) {
      // Best-effort — deleteAnthropicCopy handles errors internally.
      await deleteAnthropicCopy({
        userId: auth.userId,
        fileId: args.fileId,
        currentAnthropicFileId: file.anthropicFileId,
      });
    }
  }

  return { ok: true };
}
