// lib/files/types.ts
//
// Single source of truth for file-related constants and shared types.
//
// IMPORTANT: any value in this file that's also configured somewhere else
// (Supabase dashboard, server action validation, UI components) MUST be
// kept in sync. The whole point of co-locating them here is one source,
// many consumers.
//
// Specifically:
//   - ALLOWED_MIME_TYPES is duplicated in the Supabase Storage bucket
//     config (see the dashboard steps in lib/db/migrations/0005_files.sql).
//   - MAX_FILE_BYTES is duplicated in the same bucket config.
//   - Both are referenced from requestUploadUrls and the UI file picker.
//
// If you change anything here, update the bucket config too.

// =============================================================================
// MIME type allowlist
// =============================================================================

/**
 * The three file types we accept in v1.
 *
 *   PDF  — the bulk of legal documents. Will be readable by Claude in Chunk 7
 *          via Anthropic's Files API (image-based reading, no text extraction).
 *
 *   DOCX — modern Word documents. Stored as reference-only in Chunk 6.
 *          (Chunk 7 may or may not include DOCX in the Claude-readable set;
 *          Anthropic's Files API supports it but the read pathway differs.)
 *
 *   TXT  — plain text. Trivial. Useful for client notes, transcripts dumps.
 *
 * Old DOC (.doc), RTF, EPUB, images: all rejected for v1. Each adds parsing
 * complexity that doesn't pay off pre-PMF.
 */
export const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

/**
 * Human-readable display labels for each MIME type. Used by file row badges.
 */
export const MIME_TYPE_DISPLAY: Record<AllowedMimeType, string> = {
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'Word doc',
  'text/plain': 'Text',
};

/**
 * Type guard for runtime validation. Use in server action input checks.
 */
export function isAllowedMimeType(value: string): value is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(value);
}

/**
 * For the `<input type="file">` accept attribute.
 *
 * NOTE — the redundancy (extensions AND MIME types) is deliberate, NOT a
 * cleanup target. Browsers vary in which they honour:
 *   - Some browsers only respect file extensions (.pdf, .docx, .txt)
 *   - Others only respect MIME types (application/pdf, ...)
 *   - Some honour both
 * The doubled form covers all browsers. Don't "tidy this up" — you'll
 * accidentally lock out users on whichever browser variant gets dropped.
 *
 * The accept attribute is cosmetic anyway: the file picker filters what's
 * SHOWN to the user, but the user can always choose "All files" and pick
 * something we don't want. Real validation happens server-side in
 * requestUploadUrls + the bucket's MIME restriction.
 */
export const ACCEPT_ATTRIBUTE =
  '.pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain';

// =============================================================================
// Size caps — DECIMAL MB (matches Supabase Storage display)
// =============================================================================
//
// We use decimal MB throughout (1 MB = 1,000,000 bytes), NOT binary MB
// (which would be 1 MiB = 1,048,576 bytes). Reasons:
//
//   - Supabase Storage reports sizes in decimal MB in the dashboard
//   - Disk vendors use decimal
//   - Lawyers reading "47 MB of 250 MB used" should see the same number
//     they'd see in Supabase Studio
//
// If you change these, update the Supabase dashboard bucket config too —
// see lib/db/migrations/0005_files.sql for the steps.

/**
 * Per-file size cap. 10 MB decimal = 10,000,000 bytes.
 *
 * Matches the Supabase bucket's "Restrict file size" setting.
 *
 * Anything in the 6 MB - 10 MB range will use Supabase Storage's resumable
 * upload (TUS) pathway under the hood — see lib/storage/supabase-storage.ts.
 */
export const MAX_FILE_BYTES = 10_000_000;

/**
 * Per-matter quota. 250 MB decimal = 250,000,000 bytes.
 *
 * Enforced server-side in requestUploadUrls. Soft-deleted files don't
 * count (the quota query filters on `deleted_at IS NULL`).
 */
export const MAX_MATTER_BYTES = 250_000_000;

// =============================================================================
// AI-readability rules (used in Chunk 6 metadata, applied in Chunk 7)
// =============================================================================
//
// Anthropic's Files API has a 100-page hard limit per PDF. We compute and
// store `ai_readable` at upload time so the UI can show the right badge
// without a runtime check on every chat turn.
//
// PDFs over 100 pages: ai_readable = false, reason = "exceeds 100 pages".
// DOCX/TXT: ai_readable = true; we'll handle DOCX-specifics in Chunk 7.
// Page count extraction failed: ai_readable = true (optimistic — defer to
//   Chunk 7's actual read attempt to surface a real error).

/**
 * Anthropic's Files API per-PDF page limit. If a PDF exceeds this, we
 * mark it ai_readable = false at upload time.
 */
export const MAX_PDF_PAGES_FOR_AI = 100;

// =============================================================================
// Validation result shape
// =============================================================================

/**
 * Discriminated union for per-file upload validation results.
 *
 * Returned by requestUploadUrls as part of a structured per-file batch
 * response. The client uses these to render per-file status: accepted
 * files get progress bars and signed URLs; rejected files get red
 * "Couldn't add — ..." badges with the specific reason.
 */
export type UploadValidationResult =
  | {
      ok: true;
      filename: string;
      fileId: string;
      uploadUrl: string;
      uploadToken: string;
      storagePath: string;
    }
  | {
      ok: false;
      filename: string;
      reason:
        | 'mime_not_allowed'
        | 'file_too_large'
        | 'quota_exceeded'
        | 'empty_filename'
        | 'invalid_size'
        | 'matter_not_found';
      message: string;
      // Only set when reason === 'quota_exceeded'. Bytes still available
      // for this matter, so the UI can show "X MB remaining".
      headroomBytes?: number;
    };
