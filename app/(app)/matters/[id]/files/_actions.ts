// app/(app)/matters/[id]/files/_actions.ts
//
// Server actions for the files domain.
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
// lib/db/schema.ts or lib/files/types.ts; import them where needed.
// Inline type aliases like ActionResult below are fine because they have
// no source-side identifier import.
//
// (This rule and comment are carried forward from app/(app)/matters/_actions.ts
// — same pattern, same rationale.)
//
// =============================================================================
//
// Verbs exposed:
//   requestUploadUrls — batch quota-checked signed URL issuance
//   completeUpload — confirm storage object + extract page count
//   listMatterFilesAction — used for client-side revalidation refreshes
//   softDeleteFileAction
//   restoreFileAction — runs a fresh quota check before un-deleting
//   hardDeleteFileAction — only operates on already-soft-deleted rows
//   updateFileTagsAction
//   getDownloadUrlAction

'use server';

import { createClient } from '@/lib/supabase/server';
import {
  createFile,
  getFile,
  listFiles,
  getCurrentMatterUsage,
  setFileReadabilityMeta,
  softDeleteFile,
  restoreFile,
  hardDeleteFile,
  updateFileTags,
  sanitiseFilename,
  SanitisationError,
  type FileWithTags,
} from '@/lib/db/queries/files';
import { getMatter } from '@/lib/db/queries/matters';
import {
  getUploadUrl,
  getDownloadUrl,
  objectExists,
  deleteObject,
  buildStoragePath,
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
import { db } from '@/lib/db';
import { files as filesTable } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

// =============================================================================
// Result types (inline — no external type imports re-exported per the rule)
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
// requestUploadUrls — batch quota-checked signed URL issuance
// =============================================================================
//
// Client sends a batch of {filename, size, mimeType}. We process them
// sequentially server-side:
//
//   - Validate the matter exists and belongs to this user.
//   - For each file, in order:
//       a. Validate MIME type.
//       b. Validate size against MAX_FILE_BYTES.
//       c. Sanitise filename (reject if empty after sanitise).
//       d. Check current matter usage + sum of already-accepted-in-this-batch
//          files. If accepting this one would exceed MAX_MATTER_BYTES, reject.
//       e. Create the files row (with status implicit — see note below).
//       f. Generate a signed upload URL.
//       g. Add to accepted list.
//
// The mid-batch cap-hit UX (from the design doc §3.3) falls out of this:
// the client gets a per-file result, accepted files have uploadUrl/token,
// rejected files have a reason. The UI renders accordingly.
//
// Why no explicit `status` column on files:
//   We create the row before the storage object exists. If the client fails
//   to actually upload, the row exists but has no corresponding storage
//   object. listMatterFiles can detect this via objectExists() on read;
//   a future janitor sweeps orphans older than 30 min. Simpler than a
//   state machine for what's an uncommon failure mode.

interface RequestedFile {
  filename: string;
  size: number;
  mimeType: string;
}

export async function requestUploadUrls(args: {
  matterId: string;
  files: RequestedFile[];
}): Promise<ActionResult<{ results: UploadValidationResult[] }>> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  // Cap batch size at 50 — defense-in-depth against a malformed client
  // posting thousands of files at once.
  if (args.files.length === 0) {
    return { ok: false, error: 'No files provided.' };
  }
  if (args.files.length > 50) {
    return { ok: false, error: 'Maximum 50 files per upload batch.' };
  }

  // Verify matter ownership before any per-file work.
  const matter = await getMatter(auth.userId, args.matterId);
  if (!matter) {
    return { ok: false, error: 'Matter not found.' };
  }

  // Current usage from the DB (non-deleted files only).
  const initialUsage = await getCurrentMatterUsage(auth.userId, args.matterId);

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

    // d. Quota check (in-batch + DB)
    const projected = runningUsage + requested.size;
    if (projected > MAX_MATTER_BYTES) {
      const headroom = Math.max(0, MAX_MATTER_BYTES - runningUsage);
      results.push({
        ok: false,
        filename: requested.filename,
        reason: 'quota_exceeded',
        message:
          headroom > 0
            ? `Adding this file would exceed the case storage limit. ${formatBytes(headroom)} remaining.`
            : `This case has reached the 250 MB storage limit.`,
        headroomBytes: headroom,
      });
      continue;
    }

    // e. Create file row (no storage object yet).
    let fileRow;
    try {
      // Build the storage path AFTER we know the sanitised filename so the
      // extension comes out right.
      // We create the file row first to get the file_id, then we know the
      // storage path, then we update — but to avoid two writes, we generate
      // the path using a pre-known UUID. createFile uses Drizzle's defaultRandom,
      // so we can't predict the UUID before insert. Workaround: insert first
      // with a placeholder storage_path, then update with the real one.
      //
      // Two DB writes per accepted file is acceptable — happens once per
      // upload, not per byte. And the row needs to exist for the quota math
      // to include it in subsequent in-batch quota checks.
      fileRow = await createFile(auth.userId, {
        matterId: args.matterId,
        filename: sanitisedFilename,
        storagePath: 'placeholder', // overwritten below
        mimeType: requested.mimeType,
        fileSize: requested.size,
      });
    } catch (err) {
      // If insert fails (e.g. DB hiccup), report as a generic failure.
      // We don't want to leak details.
      // eslint-disable-next-line no-console
      console.error('[files] createFile failed:', err);
      results.push({
        ok: false,
        filename: requested.filename,
        reason: 'invalid_size', // generic; not exposing internal errors
        message: 'Could not record the upload. Please try again.',
      });
      continue;
    }

    const storagePath = buildStoragePath(
      auth.userId,
      args.matterId,
      fileRow.id,
      sanitisedFilename,
    );

    // Patch the row with the real storage path.
    // (Avoiding the createFile-returns-undefined-id problem this way is
    // less elegant than a transaction; we accept the minor extra write
    // for code simplicity.)
    try {
      await db
        .update(filesTable)
        .set({ storagePath })
        .where(
          and(eq(filesTable.id, fileRow.id), eq(filesTable.userId, auth.userId)),
        );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[files] storagePath patch failed:', err);
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
      console.error('[files] getUploadUrl failed:', err);
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
// completeUpload — confirm bytes landed + extract page count + set readability
// =============================================================================
//
// Client calls this after `supabase.storage.from('case-files').uploadToSignedUrl(...)`
// finishes successfully. We:
//   - Verify the storage object exists (defense against client lies)
//   - For PDFs: extract page count via pdf-lib (never throws — wrapped)
//   - Compute ai_readable based on page count + MIME type
//   - Persist via setFileReadabilityMeta
//
// AI-readability rules:
//   PDF, page count known, <=100 pages   → ai_readable = true,  reason = null
//   PDF, page count known, >100 pages    → ai_readable = false, reason = "PDF exceeds 100 pages"
//   PDF, page count unknown (extract fail) → ai_readable = true (optimistic), reason = null
//   DOCX                                 → ai_readable = true,  reason = null  (Chunk 7 will refine)
//   TXT                                  → ai_readable = true,  reason = null

export async function completeUpload(args: {
  fileId: string;
}): Promise<ActionResult<{ file: FileWithTags }>> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  const existing = await getFile(auth.userId, args.fileId);
  if (!existing) {
    return { ok: false, error: 'File not found.' };
  }

  // Confirm the object actually exists in storage. Defense against a
  // client that calls completeUpload without actually uploading.
  const exists = await objectExists(existing.storagePath);
  if (!exists) {
    return {
      ok: false,
      error: 'Upload did not complete. Please try again.',
    };
  }

  // For PDFs, attempt page count extraction. NEVER fail the upload on
  // extraction errors — log and continue with pageCount=null.
  let pageCount: number | null = null;
  let aiReadable = true;
  let aiReadableReason: string | null = null;

  if (existing.mimeType === 'application/pdf') {
    try {
      const bytes = await getObjectBytes(existing.storagePath);
      pageCount = await extractPageCount(bytes, existing.mimeType);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[files] page count extraction failed for', args.fileId, err);
      pageCount = null;
    }

    if (pageCount !== null && pageCount > MAX_PDF_PAGES_FOR_AI) {
      aiReadable = false;
      aiReadableReason = `PDF exceeds ${MAX_PDF_PAGES_FOR_AI} pages — too long for AI reading.`;
    }
  }

  await setFileReadabilityMeta(auth.userId, args.fileId, {
    pageCount,
    aiReadable,
    aiReadableReason,
  });

  // Re-fetch with tags (tags will be empty for a new file, but the shape
  // is consistent with what the client expects).
  const fresh = await getFile(auth.userId, args.fileId);
  if (!fresh) {
    return { ok: false, error: 'File disappeared during finalisation.' };
  }

  return { ok: true, data: { file: fresh } };
}

// =============================================================================
// listMatterFilesAction — explicit revalidation refresh
// =============================================================================
//
// Server actions in Chunk 6 are mostly mutations; reads happen via the
// page.tsx server-side fetch + FilesProvider client state. This action
// exists for cases where the client wants to force-refresh from the DB
// (e.g. after a recovery from an error state).

export async function listMatterFilesAction(args: {
  matterId: string;
}): Promise<ActionResult<{ files: FileWithTags[] }>> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  const matter = await getMatter(auth.userId, args.matterId);
  if (!matter) {
    return { ok: false, error: 'Matter not found.' };
  }

  const list = await listFiles(auth.userId, { matterId: args.matterId });
  return { ok: true, data: { files: list } };
}

// =============================================================================
// softDeleteFileAction
// =============================================================================

export async function softDeleteFileAction(args: {
  fileId: string;
}): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  const deleted = await softDeleteFile(auth.userId, args.fileId);
  if (!deleted) {
    return { ok: false, error: 'File not found.' };
  }

  // Chunk 7 hook: if deleted.anthropicFileId is non-NULL, call
  // anthropic.deleteFile(...) here and clear the column. For Chunk 6 the
  // column is always NULL so this is a no-op.

  return { ok: true };
}

// =============================================================================
// restoreFileAction — runs a FRESH quota check before un-deleting
// =============================================================================
//
// The undo-toast in the UI calls this. Per the design discussion: if the
// lawyer soft-deleted a file, then uploaded new files within the 5-second
// undo window that consumed the freed space, the restore must respect the
// 250MB cap. We re-run the quota math here and reject with a clear reason
// if it would push over.

export async function restoreFileAction(args: {
  fileId: string;
}): Promise<
  | { ok: true }
  | { ok: false; error: string; reason?: 'quota_exceeded' | 'not_found' }
> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  // We need the file's matterId + size, and to confirm it's actually
  // soft-deleted. Fetch first.
  const fileRow = await getFile(auth.userId, args.fileId);
  if (!fileRow || !fileRow.deletedAt) {
    return { ok: false, error: 'File not found.', reason: 'not_found' };
  }

  // MIGRATION 0009: restore is a matter-files concept (it rechecks the
  // matter storage quota). A conversation file has matterId = null, no
  // matter quota, and no restore UI — so guard the null case. This also
  // narrows fileRow.matterId to `string` for getCurrentMatterUsage below.
  if (!fileRow.matterId) {
    return { ok: false, error: 'File not found.', reason: 'not_found' };
  }

  // Quota recheck. getCurrentMatterUsage excludes deleted files, so we
  // add this file's size to the current usage.
  const currentUsage = await getCurrentMatterUsage(
    auth.userId,
    fileRow.matterId,
  );
  if (currentUsage + fileRow.fileSize > MAX_MATTER_BYTES) {
    return {
      ok: false,
      error: `Can't restore — case storage limit reached. Free up ${formatBytes(currentUsage + fileRow.fileSize - MAX_MATTER_BYTES)} first.`,
      reason: 'quota_exceeded',
    };
  }

  const restored = await restoreFile(auth.userId, args.fileId);
  if (!restored) {
    // Race: someone (else) hard-deleted between our fetch and now. Treat
    // as not found.
    return { ok: false, error: 'File not found.', reason: 'not_found' };
  }

  return { ok: true };
}

// =============================================================================
// hardDeleteFileAction
// =============================================================================
//
// Only callable on already-soft-deleted files. The current Chunk 6 UI does
// NOT surface this (Manage Storage modal is deferred to Chunk 7). Exported
// so it's wired for when we need it — and so the API surface from the
// design doc is complete.
//
// Also removes the storage object and (Chunk 7) the Anthropic Files API
// copy. Best-effort on the storage delete — if it fails, we log and
// proceed; the DB row deletion is the user-visible source of truth.

export async function hardDeleteFileAction(args: {
  fileId: string;
}): Promise<ActionResult> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  const deleted = await hardDeleteFile(auth.userId, args.fileId);
  if (!deleted) {
    return { ok: false, error: 'File not found or not soft-deleted.' };
  }

  // Best-effort storage cleanup. The DB row is gone; if this fails, an
  // orphan object remains in Supabase Storage. A future cleanup job can
  // sweep orphans by listing storage and cross-referencing with files
  // table. Not in scope for Chunk 6.
  try {
    await deleteObject(deleted.storagePath);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      '[files] hardDelete storage cleanup failed for',
      deleted.storagePath,
      err,
    );
  }

  // Chunk 7 hook: anthropic.deleteFile() if anthropicFileId is set.

  return { ok: true };
}

// =============================================================================
// updateFileTagsAction
// =============================================================================

export async function updateFileTagsAction(args: {
  fileId: string;
  tags: string[];
}): Promise<ActionResult<{ tags: string[] }>> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  if (args.tags.length > 10) {
    // The queries layer caps at 10 anyway, but reject loudly so the UI
    // can show a clear error.
    return { ok: false, error: 'Maximum 10 tags per file.' };
  }

  const result = await updateFileTags(auth.userId, args.fileId, args.tags);
  if (!result.ok) {
    return { ok: false, error: 'File not found.' };
  }

  return { ok: true, data: { tags: result.tags } };
}

// =============================================================================
// getDownloadUrlAction
// =============================================================================

export async function getDownloadUrlAction(args: {
  fileId: string;
}): Promise<ActionResult<{ url: string; filename: string }>> {
  const auth = await requireUser();
  if (!auth.ok) return { ok: false, error: auth.error };

  const file = await getFile(auth.userId, args.fileId);
  if (!file) {
    return { ok: false, error: 'File not found.' };
  }
  if (file.deletedAt) {
    return { ok: false, error: 'File has been deleted.' };
  }

  try {
    const url = await getDownloadUrl({
      storagePath: file.storagePath,
      downloadFilename: file.filename,
    });
    return { ok: true, data: { url, filename: file.filename } };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[files] getDownloadUrl failed:', err);
    return { ok: false, error: 'Could not create download URL.' };
  }
}

// =============================================================================
// Local formatter (kept here, not exported — type-only would break
// 'use server' rule and we don't want it shared anyway)
// =============================================================================

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
  if (bytes < 10_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes < 1_000_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}
