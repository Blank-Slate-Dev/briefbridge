// lib/anthropic/file-sync.ts
//
// Orchestration between Supabase Storage (source of truth) and Anthropic
// Files API (Claude-readable copies).
//
// Two main jobs:
//
//   ensureAnthropicCopy(file) — Given a file row, return a usable
//     anthropic_file_id. If one already exists in the row, return it.
//     If not, fetch bytes from Supabase, upload to Anthropic, persist the
//     new file_id, and return it.
//
//   deleteAnthropicCopy(file) — Remove the Anthropic-side copy and clear
//     the column. Called on soft-delete and on ai_blocked_by_user toggle.
//
// Retry policy for the Anthropic upload from the design doc:
//   - 3 attempts with backoff 1s / 3s / 9s
//   - On all-fail, return an error result for the caller to surface
//
// Caller (the /api/files-tool route) batches calls to this for the
// list of files Claude wants to read. We don't try to parallelize here —
// keep the logic simple. Caller can Promise.all() across files if useful.

import 'server-only';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { withUser } from '@/lib/db/with-user';
import { files } from '@/lib/db/schema';
import { getObjectBytes } from '@/lib/storage/supabase-storage';
import {
  uploadFileToAnthropic,
  deleteAnthropicFile,
} from './files';

// =============================================================================
// Types
// =============================================================================

export interface SyncResult {
  fileId: string; // BriefBridge file id (db row)
  filename: string; // For error reporting
  outcome:
    | { kind: 'ok'; anthropicFileId: string }
    | { kind: 'error'; message: string };
}

// =============================================================================
// ensureAnthropicCopy
// =============================================================================

/**
 * Ensures the file has a usable anthropic_file_id, uploading if needed.
 *
 * Always updates anthropic_last_used_at on success (whether we re-used
 * an existing id or freshly uploaded). This is what powers the 30-day
 * TTL design once cleanup is implemented.
 *
 * @param userId Used for the explicit ownership check on the DB update.
 *               We trust the caller to have already verified userId owns
 *               this file (via resolveFilenames or similar) but we still
 *               scope the UPDATE clause.
 */
export async function ensureAnthropicCopy(args: {
  userId: string;
  fileId: string;
  filename: string;
  mimeType: string;
  storagePath: string;
  /** Current anthropic_file_id from the DB row. May be null. */
  currentAnthropicFileId: string | null;
}): Promise<SyncResult> {
  const { userId, fileId, filename, mimeType, storagePath } = args;

  // If we already have an id, mark used and return.
  if (args.currentAnthropicFileId) {
    await withUser(userId, (tx) =>
      tx
        .update(files)
        .set({ anthropicLastUsedAt: new Date() })
        .where(and(eq(files.id, fileId), eq(files.userId, userId))),
    );
    return {
      fileId,
      filename,
      outcome: { kind: 'ok', anthropicFileId: args.currentAnthropicFileId },
    };
  }

  // No id yet — fetch bytes and upload.
  // First the bytes from Supabase Storage.
  let buffer: Buffer;
  try {
    buffer = await getObjectBytes(storagePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'storage read failed';
    return {
      fileId,
      filename,
      outcome: { kind: 'error', message: `Couldn\u2019t read file from storage: ${msg}` },
    };
  }

  // Upload with retry.
  const uploadResult = await uploadWithRetry({ buffer, filename, mimeType });
  if (uploadResult.kind === 'error') {
    return { fileId, filename, outcome: uploadResult };
  }

  // Persist the new id + used-at timestamp.
  try {
    await withUser(userId, (tx) =>
      tx
        .update(files)
        .set({
          anthropicFileId: uploadResult.anthropicFileId,
          anthropicLastUsedAt: new Date(),
        })
        .where(and(eq(files.id, fileId), eq(files.userId, userId))),
    );
  } catch (err) {
    // The upload succeeded but we couldn't persist. The Anthropic-side
    // file is now an orphan — we don't have a way to find it again. This
    // is a wasted upload (small cost), but we shouldn't fail the user's
    // request because of a DB write hiccup. Log and continue with the
    // ephemeral id.
    // eslint-disable-next-line no-console
    console.error(
      '[file-sync] Failed to persist anthropic_file_id; continuing with ephemeral id',
      err,
    );
  }

  return {
    fileId,
    filename,
    outcome: { kind: 'ok', anthropicFileId: uploadResult.anthropicFileId },
  };
}

/**
 * 3-attempt exponential backoff for the upload. Returns either a fresh
 * anthropic file_id or a structured error.
 */
async function uploadWithRetry(args: {
  buffer: Buffer | Uint8Array;
  filename: string;
  mimeType: string;
}): Promise<
  | { kind: 'ok'; anthropicFileId: string }
  | { kind: 'error'; message: string }
> {
  const delays = [1000, 3000, 9000]; // ms; last entry not actually used as a wait
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const anthropicFileId = await uploadFileToAnthropic({
        buffer: args.buffer,
        filename: args.filename,
        mimeType: args.mimeType,
      });
      return { kind: 'ok', anthropicFileId };
    } catch (err) {
      lastError = err;
      // Don't sleep after the final attempt.
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
      }
    }
  }

  const msg =
    lastError instanceof Error
      ? lastError.message
      : 'unknown error uploading to Anthropic';
  return {
    kind: 'error',
    message: `Couldn\u2019t upload to AI service after 3 attempts: ${msg}`,
  };
}

// =============================================================================
// deleteAnthropicCopy
// =============================================================================

/**
 * Removes the Anthropic-side copy and clears the DB column.
 *
 * Called in two places (per the design):
 *   1. softDeleteFile (Chunk 6 hook in queries — wired up in the action)
 *   2. setFileAiBlock(true) — when lawyer marks a file as protected
 *
 * Best-effort on the Anthropic API call. If it fails (network, etc.), we
 * still clear the DB column — the lawyer's intent is "this file should
 * not be readable by AI." Better to have a stale Anthropic-side orphan
 * than to fail the user-facing operation.
 */
export async function deleteAnthropicCopy(args: {
  userId: string;
  fileId: string;
  /** Current anthropic_file_id from the DB row. If null, this is a no-op. */
  currentAnthropicFileId: string | null;
}): Promise<void> {
  const { userId, fileId, currentAnthropicFileId } = args;
  if (!currentAnthropicFileId) return;

  // Best-effort Anthropic delete.
  try {
    await deleteAnthropicFile(currentAnthropicFileId);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[file-sync] Failed to delete Anthropic file ${currentAnthropicFileId}; clearing DB column anyway`,
      err,
    );
  }

  // Clear the column regardless of API outcome.
  await withUser(userId, (tx) =>
    tx
      .update(files)
      .set({
        anthropicFileId: null,
        anthropicLastUsedAt: null,
      })
      .where(and(eq(files.id, fileId), eq(files.userId, userId))),
  );
}
