// app/(app)/chat/_actions.ts
//
// Server actions for STANDALONE-CHAT file attachment (migration 0009).
//
// The conversation-scoped mirror of app/(app)/matters/[id]/files/_actions.ts.
// Where that file uploads files to a MATTER, this uploads them to a
// CONVERSATION (a standalone /chat that has no matter).
//
// =============================================================================
// SAME 'use server' RULE as the matter actions: async-function exports ONLY.
// No type re-exports — Turbopack's server-action compiler treats every export
// as an RPC endpoint, and dangling type identifiers cause runtime
// ReferenceErrors. Types live in lib/files/types.ts; import them.
// =============================================================================
//
// Key differences from the matter upload flow:
//
//   1. Ownership is checked via getConversation (not getMatter).
//
//   2. Quota uses getCurrentConversationUsage (not getCurrentMatterUsage),
//      still capped at MAX_MATTER_BYTES — one quota number for both scopes.
//
//   3. NO invalidateAiAccessOnUpload call. Standalone-chat files are
//      AUTO-READ (attaching IS the consent), so there's no AI-access
//      committed state to invalidate. This is the whole point of the
//      auto-read decision and makes this action simpler than its sibling.
//
//   4. Brand-new /chat has no conversation yet (the conversation is created
//      lazily by the chat route on the first message). To let a lawyer
//      attach a file BEFORE sending the first message, ensureConversation()
//      below creates an empty standalone conversation on demand and returns
//      its id, which the client then uses for the upload + the subsequent
//      chat request.

'use server';

import { createClient } from '@/lib/supabase/server';
import {
  createConversationFile,
  getCurrentConversationUsage,
  getFile,
  setFileReadabilityMeta,
  sanitiseFilename,
  SanitisationError,
  type FileWithTags,
} from '@/lib/db/queries/files';
import {
  getConversation,
  createConversation,
} from '@/lib/db/queries/conversations';
import {
  getUploadUrl,
  objectExists,
  buildConversationStoragePath,
  getObjectBytes,
} from '@/lib/storage/supabase-storage';
import { extractPageCount } from '@/lib/files/page-count';
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_BYTES,
  MAX_MATTER_BYTES,
  MAX_PDF_PAGES_FOR_AI,
  isAllowedMimeType,
  type UploadValidationResult,
} from '@/lib/files/types';
import { withUser } from '@/lib/db/with-user';
import { files as filesTable } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

// =============================================================================
// Result types (inline — no external type re-exports per the 'use server' rule)
// =============================================================================

type ActionResult<T = void> =
  | (T extends void ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };

// =============================================================================
// Auth helper
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
// ensureConversation — create a standalone conversation on demand
// =============================================================================
//
// A brand-new /chat has no conversation row until the first message is sent
// (the chat route creates it lazily). But a lawyer may want to attach a file
// BEFORE typing their first message. This action creates an empty standalone
// conversation (matter_id NULL) and returns its id, so the client has
// something to attach files to.
//
// If a conversationId is passed AND owned, it's returned as-is (idempotent —
// the client can call this unconditionally before uploading).

export async function ensureConversation(args: {
  conversationId?: string | null;
}): Promise<ActionResult<{ conversationId: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  // If a conversationId was supplied, verify ownership and reuse it.
  if (args.conversationId) {
    const existing = await getConversation(auth.userId, args.conversationId);
    if (!existing) {
      return { ok: false, error: 'Conversation not found.' };
    }
    return { ok: true, data: { conversationId: existing.id } };
  }

  // Otherwise create a fresh standalone conversation (no matter, no title yet).
  const conv = await createConversation(auth.userId, {
    matterId: null,
    title: null,
  });
  return { ok: true, data: { conversationId: conv.id } };
}

// =============================================================================
// requestConversationUploadUrls — batch quota-checked signed URL issuance
// =============================================================================
//
// Mirror of requestUploadUrls (matter version). Same per-file validation,
// same in-batch + DB quota math, same two-write storage-path patch. The
// only structural differences: ownership via getConversation, usage via
// getCurrentConversationUsage, row via createConversationFile, path via
// buildConversationStoragePath.

interface RequestedFile {
  filename: string;
  size: number;
  mimeType: string;
}

export async function requestConversationUploadUrls(args: {
  conversationId: string;
  files: RequestedFile[];
}): Promise<ActionResult<{ results: UploadValidationResult[] }>> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  if (args.files.length === 0) {
    return { ok: false, error: 'No files provided.' };
  }
  if (args.files.length > 50) {
    return { ok: false, error: 'Maximum 50 files per upload batch.' };
  }

  // Verify conversation ownership before any per-file work.
  const conversation = await getConversation(auth.userId, args.conversationId);
  if (!conversation) {
    return { ok: false, error: 'Conversation not found.' };
  }

  // Current usage from the DB (non-deleted files in this conversation).
  const initialUsage = await getCurrentConversationUsage(
    auth.userId,
    args.conversationId,
  );

  const results: UploadValidationResult[] = [];
  let runningUsage = initialUsage;

  for (const requested of args.files) {
    // a. MIME type check
    if (!isAllowedMimeType(requested.mimeType)) {
      results.push({
        ok: false,
        filename: requested.filename,
        reason: 'mime_not_allowed',
        message: `File type not supported. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`,
      });
      continue;
    }

    // b. Per-file size check
    if (!Number.isFinite(requested.size) || requested.size <= 0) {
      results.push({
        ok: false,
        filename: requested.filename,
        reason: 'invalid_size',
        message: 'Invalid file size.',
      });
      continue;
    }
    if (requested.size > MAX_FILE_BYTES) {
      results.push({
        ok: false,
        filename: requested.filename,
        reason: 'file_too_large',
        message: `File exceeds the 10 MB per-file limit.`,
      });
      continue;
    }

    // c. Filename sanitisation
    let sanitisedFilename: string;
    try {
      sanitisedFilename = sanitiseFilename(requested.filename);
    } catch (err) {
      if (err instanceof SanitisationError) {
        results.push({
          ok: false,
          filename: requested.filename,
          reason: 'empty_filename',
          message: 'Filename is empty or contains only invalid characters.',
        });
        continue;
      }
      throw err;
    }

    // d. Quota check (in-batch + DB). Same MAX_MATTER_BYTES cap as matters.
    const projected = runningUsage + requested.size;
    if (projected > MAX_MATTER_BYTES) {
      const headroom = Math.max(0, MAX_MATTER_BYTES - runningUsage);
      results.push({
        ok: false,
        filename: requested.filename,
        reason: 'quota_exceeded',
        message:
          headroom > 0
            ? `Adding this file would exceed the chat storage limit. ${formatBytes(headroom)} remaining.`
            : `This chat has reached the 250 MB storage limit.`,
        headroomBytes: headroom,
      });
      continue;
    }

    // e. Create file row (no storage object yet).
    let fileRow;
    try {
      fileRow = await createConversationFile(auth.userId, {
        conversationId: args.conversationId,
        filename: sanitisedFilename,
        storagePath: 'placeholder', // overwritten below
        mimeType: requested.mimeType,
        fileSize: requested.size,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[chat-files] createConversationFile failed:', err);
      results.push({
        ok: false,
        filename: requested.filename,
        reason: 'invalid_size',
        message: 'Could not record the upload. Please try again.',
      });
      continue;
    }

    const storagePath = buildConversationStoragePath(
      auth.userId,
      args.conversationId,
      fileRow.id,
      sanitisedFilename,
    );

    // Patch the row with the real storage path.
    //
    // RLS (Slice 3): runs through withUser so app.user_id is set for the
    // update's transaction. Without it, the restricted role's RLS policy
    // denies the write (no session identity → zero rows / failure).
    try {
      await withUser(auth.userId, (tx) =>
        tx
          .update(filesTable)
          .set({ storagePath })
          .where(
            and(eq(filesTable.id, fileRow.id), eq(filesTable.userId, auth.userId)),
          ),
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[chat-files] storagePath patch failed:', err);
      results.push({
        ok: false,
        filename: requested.filename,
        reason: 'invalid_size',
        message: 'Could not record the upload. Please try again.',
      });
      continue;
    }

    // f. Generate signed upload URL.
    let signed;
    try {
      signed = await getUploadUrl({ storagePath });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[chat-files] getUploadUrl failed:', err);
      results.push({
        ok: false,
        filename: requested.filename,
        reason: 'invalid_size',
        message: 'Could not create upload URL. Please try again.',
      });
      continue;
    }

    // g. Accepted.
    runningUsage = projected;
    results.push({
      ok: true,
      filename: sanitisedFilename,
      fileId: fileRow.id,
      uploadUrl: signed.signedUrl,
      uploadToken: signed.token,
      storagePath,
    });
  }

  return { ok: true, data: { results } };
}

// =============================================================================
// completeConversationUpload — FAST PHASE: confirm bytes landed, return ✓
// =============================================================================
//
// SPEED CHANGE (migration 0009 perf pass): this used to also download the
// file back from storage and parse it with pdf-lib to count pages — a ~3.5s
// round-trip that kept the attach chip on "uploading" the whole time. That
// page-count work is NOT needed for the file to exist or to be readable:
//
//   - files.ai_readable defaults to TRUE at row creation, and the read gate
//     (listFilesForConversation) only requires ai_readable = true. So a file
//     is readable the instant its object lands.
//   - Page count is used ONLY to DEMOTE ai_readable to false for PDFs over
//     MAX_PDF_PAGES_FOR_AI pages — a guard rail, not a prerequisite.
//
// So we now return as soon as objectExists passes (chip → ✓ in ~200ms), and
// the page-count / 100-page guard runs separately in finalizeConversationFileMeta,
// which the client fires WITHOUT await. The brief window where an over-100-page
// PDF reads as ai_readable before the guard resolves is acceptable (and the old
// code was already optimistic — extraction failure left ai_readable = true).

export async function completeConversationUpload(args: {
  fileId: string;
}): Promise<ActionResult<{ file: FileWithTags }>> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  const existing = await getFile(auth.userId, args.fileId);
  if (!existing) {
    return { ok: false, error: 'File not found.' };
  }

  // Confirm the object actually exists in storage. Defense against a client
  // that calls complete without actually uploading. This is the only check
  // that must block "ready" — it's a fast storage HEAD request.
  const exists = await objectExists(existing.storagePath);
  if (!exists) {
    return {
      ok: false,
      error: 'Upload did not complete. Please try again.',
    };
  }

  // Return immediately. The page-count guard runs in the deferred phase
  // (finalizeConversationFileMeta), fired by the client without await.
  return { ok: true, data: { file: existing } };
}

// =============================================================================
// finalizeConversationFileMeta — DEFERRED PHASE: page count + 100-page guard
// =============================================================================
//
// Fired by the client WITHOUT await, right after completeConversationUpload
// returns ✓. Does the slow work (download bytes, parse PDF, count pages) and
// demotes ai_readable to false for over-length PDFs. Never blocks the chip.
//
// Idempotent and best-effort: a failure here leaves the file ai_readable
// (the optimistic default), exactly as the old inline code did on extraction
// failure. Safe to call once per upload; safe to never call (the guard just
// won't apply, matching prior optimistic behaviour).

export async function finalizeConversationFileMeta(args: {
  fileId: string;
}): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  const existing = await getFile(auth.userId, args.fileId);
  if (!existing) {
    return { ok: false, error: 'File not found.' };
  }

  // Only PDFs have a page-count guard. Non-PDFs need no finalisation.
  if (existing.mimeType !== 'application/pdf') {
    return { ok: true };
  }

  let pageCount: number | null = null;
  let aiReadable = true;
  let aiReadableReason: string | null = null;

  try {
    const bytes = await getObjectBytes(existing.storagePath);
    pageCount = await extractPageCount(bytes, existing.mimeType);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      '[chat-files] deferred page count extraction failed for',
      args.fileId,
      err,
    );
    pageCount = null;
  }

  if (pageCount !== null && pageCount > MAX_PDF_PAGES_FOR_AI) {
    aiReadable = false;
    aiReadableReason = `PDF exceeds ${MAX_PDF_PAGES_FOR_AI} pages — too long for AI reading.`;
  }

  await setFileReadabilityMeta(auth.userId, args.fileId, {
    pageCount,
    aiReadable,
    aiReadableReason,
  });

  return { ok: true };
}

// =============================================================================
// Local formatter (not exported — type-only would break 'use server' rule)
// =============================================================================

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
  if (bytes < 10_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes < 1_000_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}