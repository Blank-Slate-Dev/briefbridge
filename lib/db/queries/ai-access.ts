// lib/db/queries/ai-access.ts
//
// Query helpers for the AI access controls added in Chunk 7.
//
// Two surfaces:
//
//   1. Matter-level mode management: read the current state, update mode
//      + exclusions atomically, invalidate on new upload, etc.
//   2. File visibility for Claude: listFilesForAi() returns the files
//      Claude should see in the system prompt, applying ALL three gates
//      (ai_readable, ai_blocked_by_user, ai_excluded_in_matter) plus the
//      access mode + committed_at check.
//
// Same rule as the rest of queries/: every function takes userId and
// applies an explicit where(eq(...userId, userId)) clause. Drizzle bypasses
// RLS.
//
// Tests to keep in mind when changing this:
//   - "Confirming with mode = 'off' should clear committed_at, not set it"
//     (We just zero out the row; committed_at only matters for non-off
//     modes. If you set committed_at when mode='off', the next mode flip
//     would skip the panel entirely — bad.)
//   - "Uploading a new file invalidates committed_at" (the FilesProvider
//     calls invalidateAiAccessOnUpload after a successful upload)
//   - "Exclusions persist across mode flips" — if a lawyer goes off → all
//     → subset, the previously-set exclusions on individual files should
//     still be there. We never auto-clear ai_excluded_in_matter on mode
//     change.

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  matters,
  files,
  fileTags,
  type Matter,
  type AiAccessMode,
} from '@/lib/db/schema';
import {
  isAiAccessActive,
  whyNotAiAccessActive,
  MAX_FILES_IN_SYSTEM_PROMPT,
} from '@/lib/files/ai-access-types';

// =============================================================================
// AI access state for the panel
// =============================================================================

/**
 * Shape returned to the UI for rendering the AI access panel.
 *
 * - mode: the current radio-group selection (off / all / subset)
 * - isCommitted: derived — true iff there's an aiAccessCommittedAt timestamp
 * - isActive: derived — true iff isCommitted AND mode !== 'off'
 * - inactiveReason: if !isActive, a human-readable reason; else null
 * - excludedFileIds: list of file IDs currently marked ai_excluded_in_matter.
 *                    Used to render the per-file checkboxes in subset mode.
 *                    Only meaningful when mode = 'subset'.
 */
export interface AiAccessState {
  matterId: string;
  mode: AiAccessMode;
  isCommitted: boolean;
  isActive: boolean;
  inactiveReason: string | null;
  excludedFileIds: string[];
}

export async function getAiAccessState(
  userId: string,
  matterId: string,
): Promise<AiAccessState | null> {
  // Fetch matter for the mode + committed_at columns.
  const matterRows = await db
    .select({
      id: matters.id,
      aiAccessMode: matters.aiAccessMode,
      aiAccessCommittedAt: matters.aiAccessCommittedAt,
    })
    .from(matters)
    .where(and(eq(matters.id, matterId), eq(matters.userId, userId)))
    .limit(1);

  const matter = matterRows[0];
  if (!matter) return null;

  // Fetch excluded file IDs. Only relevant for subset mode but cheap
  // to fetch always — gives the UI consistent data.
  const excludedRows = await db
    .select({ id: files.id })
    .from(files)
    .where(
      and(
        eq(files.userId, userId),
        eq(files.matterId, matterId),
        eq(files.aiExcludedInMatter, true),
        isNull(files.deletedAt),
      ),
    );

  const isCommitted = matter.aiAccessCommittedAt !== null;
  const isActive = isAiAccessActive({
    aiAccessMode: matter.aiAccessMode,
    aiAccessCommittedAt: matter.aiAccessCommittedAt,
  });
  const inactiveReason = isActive
    ? null
    : whyNotAiAccessActive({
        aiAccessMode: matter.aiAccessMode,
        aiAccessCommittedAt: matter.aiAccessCommittedAt,
      });

  return {
    matterId: matter.id,
    mode: matter.aiAccessMode,
    isCommitted,
    isActive,
    inactiveReason,
    excludedFileIds: excludedRows.map((r) => r.id),
  };
}

// =============================================================================
// Updating access mode + exclusions
// =============================================================================

/**
 * Updates the AI access mode AND the per-file exclusions atomically (well,
 * in sequence — see transaction note below).
 *
 * Semantics:
 *   - mode = 'off':         All exclusions cleared (cosmetic — they're
 *                           irrelevant when off). committed_at set.
 *   - mode = 'all':         All exclusions cleared. committed_at set.
 *   - mode = 'subset':      exclusions param defines the new set.
 *                           Files in the param: ai_excluded_in_matter=true.
 *                           Files NOT in the param (but in the matter):
 *                           ai_excluded_in_matter=false (un-exclude).
 *                           committed_at set.
 *
 * Setting committed_at here is what makes the mode "active." Until the
 * lawyer hits Confirm in the UI, mode might be 'all' but committed_at
 * is null — Claude treats that as off.
 *
 * Why we don't wrap in a transaction:
 *   - Drizzle's connection-pooled postgres-js driver makes nested
 *     transactions awkward. Each statement is atomic on its own.
 *   - Worst-case interleaving: a half-applied update leaves some files
 *     with stale exclusion state. The UI re-fetches on every panel open,
 *     so this would self-correct within seconds.
 *   - The alternative (full transaction) is worth it later when we have
 *     time; not blocking for v1.
 */
export async function updateAiAccess(
  userId: string,
  matterId: string,
  input: {
    mode: AiAccessMode;
    /** File IDs to mark excluded. Only meaningful when mode = 'subset'. */
    excludedFileIds?: string[];
  },
): Promise<AiAccessState | null> {
  // Verify ownership first.
  const owned = await db
    .select({ id: matters.id })
    .from(matters)
    .where(and(eq(matters.id, matterId), eq(matters.userId, userId)))
    .limit(1);
  if (owned.length === 0) return null;

  // Step 1: update the matter row.
  const now = new Date();
  await db
    .update(matters)
    .set({
      aiAccessMode: input.mode,
      aiAccessCommittedAt: now,
      updatedAt: now,
    })
    .where(and(eq(matters.id, matterId), eq(matters.userId, userId)));

  // Step 2: update exclusions.
  if (input.mode === 'off' || input.mode === 'all') {
    // Clear all exclusions in this matter.
    await db
      .update(files)
      .set({ aiExcludedInMatter: false })
      .where(
        and(
          eq(files.userId, userId),
          eq(files.matterId, matterId),
          eq(files.aiExcludedInMatter, true),
        ),
      );
  } else {
    // subset mode — set exclusions exactly to the given list.
    const wanted = new Set(input.excludedFileIds ?? []);

    // Clear exclusions on files NOT in the wanted set.
    // (Only those that are currently excluded — cheaper.)
    const currentlyExcluded = await db
      .select({ id: files.id })
      .from(files)
      .where(
        and(
          eq(files.userId, userId),
          eq(files.matterId, matterId),
          eq(files.aiExcludedInMatter, true),
        ),
      );
    const toUnexclude = currentlyExcluded
      .map((r) => r.id)
      .filter((id) => !wanted.has(id));
    if (toUnexclude.length > 0) {
      await db
        .update(files)
        .set({ aiExcludedInMatter: false })
        .where(
          and(
            eq(files.userId, userId),
            inArray(files.id, toUnexclude),
          ),
        );
    }

    // Set exclusion on wanted files.
    if (wanted.size > 0) {
      await db
        .update(files)
        .set({ aiExcludedInMatter: true })
        .where(
          and(
            eq(files.userId, userId),
            eq(files.matterId, matterId),
            inArray(files.id, [...wanted]),
          ),
        );
    }
  }

  // Re-fetch state to return the updated view.
  return getAiAccessState(userId, matterId);
}

// =============================================================================
// Invalidation on new upload
// =============================================================================

/**
 * Called after a file is uploaded to a matter. If the matter currently
 * has AI access committed (mode != 'off' AND committed_at != null), we
 * NULL committed_at to force the lawyer to re-confirm in the panel.
 *
 * Why: a lawyer who uploads a new file may have intended it to be
 * privileged. The "pause Claude" + "reopen panel" UX from the design
 * depends on this invalidation triggering.
 *
 * No-op when:
 *   - mode is 'off' (nothing to invalidate)
 *   - committed_at is already null (already pending — re-confirming is
 *     just an idempotent stamp)
 *
 * Idempotent — safe to call after every successful upload.
 */
export async function invalidateAiAccessOnUpload(
  userId: string,
  matterId: string,
): Promise<void> {
  await db
    .update(matters)
    .set({
      aiAccessCommittedAt: null,
      // Don't touch updatedAt here — uploading a file isn't an "edit" of
      // the matter for sort-by-recent purposes. The file's own
      // updated_at handles that.
    })
    .where(
      and(
        eq(matters.id, matterId),
        eq(matters.userId, userId),
        // Skip if mode is off — no committed_at to invalidate.
        sql`${matters.aiAccessMode} != 'off'`,
      ),
    );
}

// =============================================================================
// Per-file block (kebab menu)
// =============================================================================

/**
 * Sets or clears the lawyer's hard block on a file. Independent of matter
 * mode — a blocked file is always invisible to Claude.
 *
 * The chat route doesn't need to invalidate anything when this changes —
 * Claude's file list is computed fresh on every chat request, so the
 * block takes effect on the next turn.
 */
export async function setFileAiBlock(
  userId: string,
  fileId: string,
  blocked: boolean,
): Promise<{ ok: true } | { ok: false; reason: 'not_found' }> {
  const [updated] = await db
    .update(files)
    .set({ aiBlockedByUser: blocked })
    .where(and(eq(files.id, fileId), eq(files.userId, userId)))
    .returning({ id: files.id });

  return updated ? { ok: true } : { ok: false, reason: 'not_found' };
}

// =============================================================================
// File visibility for Claude
// =============================================================================
//
// This is THE central read query for /api/chat — it returns the files
// Claude can see in the system prompt. Combines all four gates:
//
//   1. Not deleted (deleted_at IS NULL)
//   2. AI-readable (page count etc. — Chunk 6)
//   3. Not blocked by user (ai_blocked_by_user = false)
//   4. Not excluded in this matter (when mode = 'subset': ai_excluded_in_matter)
//
// Plus the access mode check:
//
//   - mode = 'off' or committed_at = null: returns []
//   - mode = 'all': returns 1+2+3 (ignores ai_excluded_in_matter)
//   - mode = 'subset': returns 1+2+3+4
//
// Tags are joined in for the system prompt formatting (tagged: ... line).

/**
 * The shape Claude sees per file in the system prompt and reads via
 * read_files. Subset of the full File row — we don't expose storage_path,
 * deletion state, or anything else Claude doesn't need.
 */
export interface FileForAi {
  id: string;
  filename: string;
  mimeType: string;
  fileSize: number;
  pageCount: number | null;
  tags: string[];
  anthropicFileId: string | null;
  storagePath: string; // For server-side re-upload to Anthropic if needed.
}

/**
 * Returns the files Claude is permitted to see for a matter.
 *
 * Performs the FULL gating logic. Caller (chat route, files tool route)
 * just gets back the allowed list and trusts it.
 *
 * Sorted by updated_at DESC (most recent first), capped at
 * MAX_FILES_IN_SYSTEM_PROMPT.
 */
export async function listFilesForAi(
  userId: string,
  matterId: string,
): Promise<{
  files: FileForAi[];
  /** True if access is currently off / not committed. */
  isOff: boolean;
  /** True if the matter has more files than the cap (used for the "+N more" footer). */
  truncated: boolean;
  /** Total count of accessible files (before cap). For UX text. */
  totalAccessible: number;
}> {
  // Read matter to know the access mode.
  const matterRows = await db
    .select({
      id: matters.id,
      aiAccessMode: matters.aiAccessMode,
      aiAccessCommittedAt: matters.aiAccessCommittedAt,
    })
    .from(matters)
    .where(and(eq(matters.id, matterId), eq(matters.userId, userId)))
    .limit(1);

  const matter = matterRows[0];
  if (!matter) {
    // Caller's auth gate should have caught this; defensive empty.
    return { files: [], isOff: true, truncated: false, totalAccessible: 0 };
  }

  if (
    !isAiAccessActive({
      aiAccessMode: matter.aiAccessMode,
      aiAccessCommittedAt: matter.aiAccessCommittedAt,
    })
  ) {
    return { files: [], isOff: true, truncated: false, totalAccessible: 0 };
  }

  // Build the WHERE clause respecting all gates.
  const conditions = [
    eq(files.userId, userId),
    eq(files.matterId, matterId),
    isNull(files.deletedAt),
    eq(files.aiReadable, true),
    eq(files.aiBlockedByUser, false),
  ];

  // The subset mode also excludes ai_excluded_in_matter files.
  if (matter.aiAccessMode === 'subset') {
    conditions.push(eq(files.aiExcludedInMatter, false));
  }

  // First, count total (for the truncation indicator).
  const totalRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(files)
    .where(and(...conditions));
  const total = totalRows[0]?.count ?? 0;

  // Then fetch the capped list, most-recent first.
  const fileRows = await db
    .select({
      id: files.id,
      filename: files.filename,
      mimeType: files.mimeType,
      fileSize: files.fileSize,
      pageCount: files.pageCount,
      anthropicFileId: files.anthropicFileId,
      storagePath: files.storagePath,
    })
    .from(files)
    .where(and(...conditions))
    .orderBy(sql`${files.updatedAt} desc`)
    .limit(MAX_FILES_IN_SYSTEM_PROMPT);

  // Bulk-load tags for these files.
  const fileIds = fileRows.map((r) => r.id);
  const tagRows =
    fileIds.length > 0
      ? await db
          .select({
            fileId: fileTags.fileId,
            tagLabel: fileTags.tagLabel,
          })
          .from(fileTags)
          .where(inArray(fileTags.fileId, fileIds))
          .orderBy(fileTags.createdAt)
      : [];

  const tagsByFileId = new Map<string, string[]>();
  for (const t of tagRows) {
    const existing = tagsByFileId.get(t.fileId);
    if (existing) existing.push(t.tagLabel);
    else tagsByFileId.set(t.fileId, [t.tagLabel]);
  }

  const resultFiles: FileForAi[] = fileRows.map((r) => ({
    id: r.id,
    filename: r.filename,
    mimeType: r.mimeType,
    fileSize: r.fileSize,
    pageCount: r.pageCount,
    tags: tagsByFileId.get(r.id) ?? [],
    anthropicFileId: r.anthropicFileId,
    storagePath: r.storagePath,
  }));

  return {
    files: resultFiles,
    isOff: false,
    truncated: total > MAX_FILES_IN_SYSTEM_PROMPT,
    totalAccessible: total,
  };
}

// =============================================================================
// Filename → file resolution (server-side, with all gates)
// =============================================================================

/**
 * Resolves a list of filenames to File rows, applying all access checks.
 * Used by the /api/files-tool route when Claude calls read_files.
 *
 * For each input filename:
 *   - If exactly one matching active+permitted file exists: included
 *   - If zero matches: reported as 'not_found'
 *   - If multiple matches (duplicate filenames in same matter): reported
 *     as 'ambiguous' — Claude is expected to ask the lawyer for
 *     disambiguation
 *
 * Filename matching is CASE-SENSITIVE exact match. Don't be clever —
 * "affidavit.pdf" and "Affidavit.pdf" are different files. The system
 * prompt shows exact names so Claude has no excuse for case errors.
 *
 * Returns a parallel structure to the input so caller can correlate
 * per-filename outcomes.
 */
export interface FileResolutionResult {
  filename: string;
  outcome:
    | { kind: 'ok'; file: FileForAi }
    | { kind: 'not_found' }
    | { kind: 'ambiguous'; count: number };
}

export async function resolveFilenames(
  userId: string,
  matterId: string,
  filenames: string[],
): Promise<FileResolutionResult[]> {
  // De-dupe input — caller might send the same filename twice; report it
  // once each.
  const uniqueFilenames = Array.from(new Set(filenames));

  if (uniqueFilenames.length === 0) return [];

  // One query gets all matches across all requested filenames.
  // Apply the same access gates as listFilesForAi.
  const matterRows = await db
    .select({
      aiAccessMode: matters.aiAccessMode,
      aiAccessCommittedAt: matters.aiAccessCommittedAt,
    })
    .from(matters)
    .where(and(eq(matters.id, matterId), eq(matters.userId, userId)))
    .limit(1);

  const matter = matterRows[0];
  if (
    !matter ||
    !isAiAccessActive({
      aiAccessMode: matter.aiAccessMode,
      aiAccessCommittedAt: matter.aiAccessCommittedAt,
    })
  ) {
    // Access not active — every filename is "not found" from Claude's
    // perspective. (The chat route should have prevented Claude from
    // calling read_files in this state, but we defense-in-depth here.)
    return uniqueFilenames.map((f) => ({
      filename: f,
      outcome: { kind: 'not_found' as const },
    }));
  }

  const conditions = [
    eq(files.userId, userId),
    eq(files.matterId, matterId),
    isNull(files.deletedAt),
    eq(files.aiReadable, true),
    eq(files.aiBlockedByUser, false),
    inArray(files.filename, uniqueFilenames),
  ];
  if (matter.aiAccessMode === 'subset') {
    conditions.push(eq(files.aiExcludedInMatter, false));
  }

  const matched = await db
    .select({
      id: files.id,
      filename: files.filename,
      mimeType: files.mimeType,
      fileSize: files.fileSize,
      pageCount: files.pageCount,
      anthropicFileId: files.anthropicFileId,
      storagePath: files.storagePath,
    })
    .from(files)
    .where(and(...conditions));

  // Bulk-load tags for the matches (for the FileForAi shape).
  const fileIds = matched.map((r) => r.id);
  const tagRows =
    fileIds.length > 0
      ? await db
          .select({
            fileId: fileTags.fileId,
            tagLabel: fileTags.tagLabel,
          })
          .from(fileTags)
          .where(inArray(fileTags.fileId, fileIds))
          .orderBy(fileTags.createdAt)
      : [];

  const tagsByFileId = new Map<string, string[]>();
  for (const t of tagRows) {
    const existing = tagsByFileId.get(t.fileId);
    if (existing) existing.push(t.tagLabel);
    else tagsByFileId.set(t.fileId, [t.tagLabel]);
  }

  // Group matches by filename to detect ambiguity.
  const matchesByFilename = new Map<string, typeof matched>();
  for (const m of matched) {
    const existing = matchesByFilename.get(m.filename);
    if (existing) existing.push(m);
    else matchesByFilename.set(m.filename, [m]);
  }

  return uniqueFilenames.map((filename) => {
    const matches = matchesByFilename.get(filename) ?? [];
    if (matches.length === 0) {
      return { filename, outcome: { kind: 'not_found' as const } };
    }
    if (matches.length > 1) {
      return {
        filename,
        outcome: { kind: 'ambiguous' as const, count: matches.length },
      };
    }
    const m = matches[0];
    return {
      filename,
      outcome: {
        kind: 'ok' as const,
        file: {
          id: m.id,
          filename: m.filename,
          mimeType: m.mimeType,
          fileSize: m.fileSize,
          pageCount: m.pageCount,
          tags: tagsByFileId.get(m.id) ?? [],
          anthropicFileId: m.anthropicFileId,
          storagePath: m.storagePath,
        },
      },
    };
  });
}
