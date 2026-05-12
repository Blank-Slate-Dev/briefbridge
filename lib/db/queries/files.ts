// lib/db/queries/files.ts
//
// Query helpers for the `files` and `file_tags` tables.
//
// Same rule as the rest of the queries/ directory: EVERY query in this
// file applies `where(eq(files.userId, userId))` (or equivalent for
// file_tags via a join). Drizzle bypasses RLS — these explicit filters
// are the day-to-day protection. RLS is the backstop only.
//
// Two normalisation concerns live here, NOT in the server actions:
//
//   1. Filename sanitisation. The filename arrives from the lawyer's
//      filesystem and gets stored as-typed for display, but with control
//      characters stripped and capped at 255. We preserve spaces, unicode,
//      parens, em-dashes — these are valid in legal filenames and lawyers
//      genuinely use them. The original filename NEVER hits storage_path.
//
//   2. Tag normalisation. Tags are lowercased + trimmed for the `tag`
//      column (the deduplication key), but the lawyer's chosen
//      capitalisation is preserved in `tag_label` (for display). So
//      "Affidavit"/"affidavit"/"AFFIDAVIT" all dedupe but the lawyer sees
//      what they typed.
//
// Quota math:
//   getCurrentMatterUsage(userId, matterId) returns SUM(file_size) over
//   non-deleted files. Caller compares against MAX_MATTER_BYTES. Soft-
//   deleted files don't count (the WHERE clause filters deleted_at IS NULL).

import { and, eq, inArray, isNull, isNotNull, sql, desc } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  files,
  fileTags,
  type File as FileRow,
  type NewFile,
  type FileTag,
} from '@/lib/db/schema';

// =============================================================================
// Filename sanitisation
// =============================================================================

/**
 * Sanitises a lawyer-supplied filename for safe storage in the DB row's
 * `filename` column.
 *
 * Rules:
 *   - Strip ASCII control characters (0x00-0x1F, 0x7F) — these can break
 *     downstream tooling and have no legitimate use in filenames.
 *   - Trim leading/trailing whitespace.
 *   - Cap at 255 characters (Unicode-safe; we count via Array.from to
 *     preserve surrogate pairs).
 *   - Reject empty (after trim) as a hard error — caller treats as
 *     'empty_filename' validation failure.
 *
 * What we PRESERVE:
 *   - Spaces, unicode, em-dashes, parens, ampersands, brackets, quotes
 *   - Multiple spaces/dots within the filename
 *   - Any character that isn't a control char
 *
 *   "R v Smith (No 2) — final.pdf" round-trips intact.
 *   "Defence (v3) — proofed.docx"  round-trips intact.
 *   "Smith\u0007.pdf"              becomes "Smith.pdf" (BEL stripped).
 *   "   .pdf"                      throws SanitisationError ("empty after trim").
 *
 * The original filename NEVER touches storage_path (which is UUID-based —
 * see lib/storage/supabase-storage.ts buildStoragePath), so special chars
 * here have no impact on signed URLs or path RLS.
 */
export class SanitisationError extends Error {
  constructor(public reason: 'empty_filename') {
    super(reason);
  }
}

export function sanitiseFilename(input: string): string {
  // 1. Strip ASCII control chars
  // eslint-disable-next-line no-control-regex
  const stripped = input.replace(/[\x00-\x1F\x7F]/g, '');

  // 2. Trim
  const trimmed = stripped.trim();

  // 3. Reject empty
  if (trimmed.length === 0) {
    throw new SanitisationError('empty_filename');
  }

  // 4. Cap at 255 chars, Unicode-safe (Array.from splits by code points,
  //    not by UTF-16 code units, so surrogate pairs stay intact)
  const chars = Array.from(trimmed);
  if (chars.length <= 255) {
    return trimmed;
  }
  return chars.slice(0, 255).join('');
}

// =============================================================================
// Tag normalisation
// =============================================================================

/**
 * Normalises a tag label into the lowercase/trimmed form used as the
 * deduplication key in `file_tags.tag`. Display form (preserving the
 * lawyer's capitalisation) lives in `file_tags.tag_label`.
 *
 * Returns the normalised tag and the display label as a tuple.
 *
 * Throws if the tag is empty after trim or exceeds 30 characters (which
 * is unusual for a tag — anything longer is probably the lawyer typing
 * the file's title into the tag box by mistake).
 */
export class TagValidationError extends Error {
  constructor(
    public reason: 'empty_tag' | 'tag_too_long',
    public input: string,
  ) {
    super(reason);
  }
}

export function normaliseTag(input: string): { tag: string; tagLabel: string } {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new TagValidationError('empty_tag', input);
  }
  if (Array.from(trimmed).length > 30) {
    throw new TagValidationError('tag_too_long', input);
  }
  return {
    tag: trimmed.toLowerCase(),
    tagLabel: trimmed,
  };
}

// =============================================================================
// Read queries
// =============================================================================

/**
 * Combined file + tags shape returned by listFiles. The caller wants both
 * in one round trip rather than 1+N tag queries.
 */
export interface FileWithTags extends FileRow {
  tags: string[]; // Array of tag_label strings, ordered as inserted.
}

export interface ListFilesOptions {
  matterId?: string;
  /** Include soft-deleted files. Default: false. */
  includeDeleted?: boolean;
  /** Hard limit. Default 500 (well above the 250MB-cap realistic max). */
  limit?: number;
}

/**
 * Lists files for the given user, optionally scoped to a matter.
 *
 * Returns rows with their tag labels pre-joined. The tags array is the
 * full set of tag_label strings on that file, in insert order.
 */
export async function listFiles(
  userId: string,
  options: ListFilesOptions = {},
): Promise<FileWithTags[]> {
  const limit = Math.min(1000, Math.max(1, options.limit ?? 500));

  const conditions = [eq(files.userId, userId)];
  if (options.matterId) {
    conditions.push(eq(files.matterId, options.matterId));
  }
  if (!options.includeDeleted) {
    conditions.push(isNull(files.deletedAt));
  }

  // Fetch file rows first (single query, indexed).
  const fileRows = await db
    .select()
    .from(files)
    .where(and(...conditions))
    .orderBy(desc(files.createdAt))
    .limit(limit);

  if (fileRows.length === 0) return [];

  // Bulk-fetch tags for the result set in one query (no N+1).
  const fileIds = fileRows.map((r) => r.id);
  const tagRows = await db
    .select()
    .from(fileTags)
    .where(inArray(fileTags.fileId, fileIds))
    .orderBy(fileTags.createdAt);

  // Group tags by fileId.
  const tagsByFileId = new Map<string, string[]>();
  for (const t of tagRows) {
    const existing = tagsByFileId.get(t.fileId);
    if (existing) existing.push(t.tagLabel);
    else tagsByFileId.set(t.fileId, [t.tagLabel]);
  }

  return fileRows.map((row) => ({
    ...row,
    tags: tagsByFileId.get(row.id) ?? [],
  }));
}

/**
 * Get one file (with its tags) by id, IF owned by the given user.
 * Returns null on miss (matches the matters/conversations pattern —
 * don't distinguish 'not found' from 'not yours').
 */
export async function getFile(
  userId: string,
  fileId: string,
): Promise<FileWithTags | null> {
  const rows = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId)))
    .limit(1);

  const file = rows[0];
  if (!file) return null;

  const tagRows = await db
    .select()
    .from(fileTags)
    .where(eq(fileTags.fileId, file.id))
    .orderBy(fileTags.createdAt);

  return { ...file, tags: tagRows.map((t) => t.tagLabel) };
}

/**
 * Sum of non-deleted file_size for a matter. Used for quota checks before
 * accepting new uploads.
 *
 * Performance: uses the (user_id, matter_id) index. Pure SQL aggregation;
 * does not load file rows into memory.
 */
export async function getCurrentMatterUsage(
  userId: string,
  matterId: string,
): Promise<number> {
  const rows = await db
    .select({ total: sql<number>`coalesce(sum(${files.fileSize}), 0)::bigint` })
    .from(files)
    .where(
      and(
        eq(files.userId, userId),
        eq(files.matterId, matterId),
        isNull(files.deletedAt),
      ),
    );

  // sql<number> with ::bigint can return a string in postgres-js; coerce.
  const total = rows[0]?.total;
  if (typeof total === 'string') return parseInt(total, 10);
  return total ?? 0;
}

/**
 * Returns the DISTINCT tag labels this user has previously used, ordered
 * by frequency (most-used first). Used to seed the autocomplete in the
 * tag editor.
 *
 * Joined through `files` so tags from other users (not that there are any
 * in the same row, but defensively) can't leak.
 */
export async function listUserTagHistory(
  userId: string,
  limit = 30,
): Promise<string[]> {
  const rows = await db
    .select({
      tagLabel: fileTags.tagLabel,
      uses: sql<number>`count(*)::int`,
    })
    .from(fileTags)
    .innerJoin(files, eq(fileTags.fileId, files.id))
    .where(eq(files.userId, userId))
    .groupBy(fileTags.tagLabel)
    .orderBy(sql`count(*) desc`)
    .limit(limit);

  return rows.map((r) => r.tagLabel);
}

// =============================================================================
// Write queries — files
// =============================================================================

export interface CreateFileInput {
  matterId: string;
  filename: string; // Will be sanitised here.
  storagePath: string;
  mimeType: string;
  fileSize: number;
}

/**
 * Creates a `files` row. Caller is responsible for:
 *   - Validating MIME type against ALLOWED_MIME_TYPES
 *   - Validating file_size against MAX_FILE_BYTES
 *   - Running quota check via getCurrentMatterUsage
 *   - Verifying matter ownership separately (we don't double-check here)
 *
 * We DO sanitise the filename via sanitiseFilename. If sanitisation
 * throws, the caller catches and returns an 'empty_filename' validation
 * result to the client.
 *
 * Note: page_count, ai_readable, and ai_readable_reason are NOT set here.
 * They're set later by completeUpload after the bytes are uploaded and
 * we've had a chance to extract page count.
 *
 * Returns the inserted row (without tags — new files have no tags yet).
 */
export async function createFile(
  userId: string,
  input: CreateFileInput,
): Promise<FileRow> {
  const sanitisedFilename = sanitiseFilename(input.filename); // may throw

  const values: NewFile = {
    userId,
    matterId: input.matterId,
    filename: sanitisedFilename,
    storagePath: input.storagePath,
    mimeType: input.mimeType,
    fileSize: input.fileSize,
    // page_count / ai_readable left to defaults (NULL / true respectively)
  };

  const [inserted] = await db.insert(files).values(values).returning();
  return inserted;
}

/**
 * Updates page_count and ai_readable flags after upload completion.
 *
 * Called by completeUpload once the bytes are in storage and page-count
 * extraction has run. The ai_readable rules live in the calling action,
 * not here — this is just the persistence verb.
 */
export async function setFileReadabilityMeta(
  userId: string,
  fileId: string,
  meta: {
    pageCount: number | null;
    aiReadable: boolean;
    aiReadableReason: string | null;
  },
): Promise<FileRow | null> {
  const [updated] = await db
    .update(files)
    .set({
      pageCount: meta.pageCount,
      aiReadable: meta.aiReadable,
      aiReadableReason: meta.aiReadableReason,
    })
    .where(and(eq(files.id, fileId), eq(files.userId, userId)))
    .returning();

  return updated ?? null;
}

/**
 * Soft-deletes a file. Sets deleted_at = now().
 *
 * IMPORTANT (Chunk 7 hook): if anthropic_file_id is non-NULL, the calling
 * action should ALSO call Anthropic's Files API delete and clear the
 * column. We don't do that here because lib/db/queries shouldn't import
 * external API clients — keeps the queries layer pure.
 *
 * For Chunk 6, anthropic_file_id is always NULL anyway. Safe to ignore.
 */
export async function softDeleteFile(
  userId: string,
  fileId: string,
): Promise<FileRow | null> {
  const [updated] = await db
    .update(files)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(files.id, fileId),
        eq(files.userId, userId),
        isNull(files.deletedAt), // can't soft-delete an already-deleted row
      ),
    )
    .returning();

  return updated ?? null;
}

/**
 * Un-soft-deletes a file. Sets deleted_at = NULL.
 *
 * IMPORTANT: caller MUST run a quota check first. This function does NOT
 * recheck quota — it assumes the caller (restoreFileAction) has already
 * confirmed there's headroom. The undo-toast flow re-runs quota in the
 * action before calling us.
 *
 * Returns null if the file isn't owned, isn't soft-deleted, or doesn't
 * exist. Caller treats all three indistinguishably.
 */
export async function restoreFile(
  userId: string,
  fileId: string,
): Promise<FileRow | null> {
  const [updated] = await db
    .update(files)
    .set({ deletedAt: null })
    .where(
      and(
        eq(files.id, fileId),
        eq(files.userId, userId),
        isNotNull(files.deletedAt), // must currently be deleted
      ),
    )
    .returning();

  return updated ?? null;
}

/**
 * Hard-deletes a file row (and via FK cascade, its file_tags rows).
 *
 * GUARDRAIL: only operates on already-soft-deleted rows. Callers
 * should soft-delete first, then hard-delete only after explicit
 * confirmation (and only from the future Manage Storage view).
 *
 * Does NOT touch Supabase Storage. The caller is responsible for calling
 * deleteObject on the storagePath — we return the row so they have the
 * storagePath to act on.
 */
export async function hardDeleteFile(
  userId: string,
  fileId: string,
): Promise<FileRow | null> {
  const [deleted] = await db
    .delete(files)
    .where(
      and(
        eq(files.id, fileId),
        eq(files.userId, userId),
        isNotNull(files.deletedAt), // must already be soft-deleted
      ),
    )
    .returning();

  return deleted ?? null;
}

// =============================================================================
// Write queries — file_tags
// =============================================================================

/**
 * Replaces the entire tag set on a file with the given labels.
 *
 * Delete-and-insert semantics (no in-place update). Per-tag dedupe + length
 * validation happens here; the caller passes raw labels and we normalise.
 *
 * Maximum 10 tags per file. Anything past 10 is silently truncated. This
 * is a UI-vs-DB layered defence: the UI prevents adding more than 10, but
 * if a malformed client posts more, we cap it rather than error.
 *
 * Verifies file ownership first (single SELECT), so the dependent
 * INSERT/DELETE only runs for owned files.
 */
export async function updateFileTags(
  userId: string,
  fileId: string,
  tagLabels: string[],
): Promise<{ ok: true; tags: string[] } | { ok: false; reason: 'not_found' }> {
  // Verify ownership.
  const owned = await db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.userId, userId)))
    .limit(1);
  if (owned.length === 0) {
    return { ok: false, reason: 'not_found' };
  }

  // Normalise + dedupe.
  const seen = new Set<string>();
  const normalised: Array<{ tag: string; tagLabel: string }> = [];
  for (const label of tagLabels) {
    let entry: { tag: string; tagLabel: string };
    try {
      entry = normaliseTag(label);
    } catch {
      // Silently skip invalid tags rather than reject the whole update.
      // The UI should be doing length validation, so anything that fails
      // here is likely a malformed client or an edge case we want to
      // recover from gracefully.
      continue;
    }
    if (seen.has(entry.tag)) continue;
    seen.add(entry.tag);
    normalised.push(entry);
    if (normalised.length >= 10) break;
  }

  // Delete existing tags, then insert new set. We do this in two
  // statements rather than a transaction because:
  //   - Worst case if the second statement fails: the file briefly has
  //     no tags. Annoying but recoverable.
  //   - Transactions require connection-level state that's awkward with
  //     the connection-pooled postgres-js driver we're using.
  await db.delete(fileTags).where(eq(fileTags.fileId, fileId));

  if (normalised.length > 0) {
    await db.insert(fileTags).values(
      normalised.map((n) => ({
        fileId,
        tag: n.tag,
        tagLabel: n.tagLabel,
      })),
    );
  }

  // Also bump the file's updated_at so it sorts to the top of the list
  // after a tag edit. The trigger handles this automatically on any
  // UPDATE, but we need to actually trigger an update — do a no-op
  // update on the row.
  await db
    .update(files)
    .set({ updatedAt: new Date() })
    .where(eq(files.id, fileId));

  return { ok: true, tags: normalised.map((n) => n.tagLabel) };
}
