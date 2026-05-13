// lib/files/ai-access-types.ts
//
// Single source of truth for AI-access-related constants, similar to how
// lib/files/types.ts is the source of truth for MIME types and size caps.
//
// What lives here:
//   - The 3-value AiAccessMode tuple (matches the union in schema.ts)
//   - Display labels for the UI
//   - The 100k token cap per read_files tool call
//   - tokenEstimate() — rough heuristic for capacity planning
//   - Validation helpers for the API surface
//
// What does NOT live here:
//   - The AiAccessMode TYPE (defined in schema.ts; we just re-export)
//   - Citation types (defined in schema.ts)
//   - Per-file caps like MAX_FILE_BYTES (in lib/files/types.ts)

import type { AiAccessMode } from '@/lib/db/schema';

// Re-export for convenience — many consumers want the type from one file.
export type { AiAccessMode } from '@/lib/db/schema';

// =============================================================================
// Mode tuple and validation
// =============================================================================

/**
 * Canonical ordered tuple of all valid AiAccessMode values.
 *
 * MUST stay in sync with:
 *   - The AiAccessMode union in schema.ts
 *   - The CHECK constraint in 0006_chunk7.sql
 *
 * Used for:
 *   - Runtime validation (isValidAiAccessMode)
 *   - UI rendering of the radio group
 */
export const AI_ACCESS_MODES = ['off', 'all', 'subset'] as const;

/**
 * Runtime type guard. Use in server actions / API routes to validate
 * incoming string values before treating them as AiAccessMode.
 */
export function isValidAiAccessMode(value: unknown): value is AiAccessMode {
  return (
    typeof value === 'string' &&
    (AI_ACCESS_MODES as readonly string[]).includes(value)
  );
}

// =============================================================================
// Display labels for the UI
// =============================================================================
//
// Centralised here so the AI access panel, any future "active modes"
// indicator, and admin views all use identical wording.

export const AI_ACCESS_MODE_LABELS: Record<AiAccessMode, string> = {
  off: 'Off',
  all: 'On — all files',
  subset: 'On — selected files',
};

export const AI_ACCESS_MODE_DESCRIPTIONS: Record<AiAccessMode, string> = {
  off: 'Claude cannot read any files in this case.',
  all: 'Claude can read every file in this case.',
  subset: 'Claude can read every file except the ones you exclude.',
};

// =============================================================================
// Token cap — per read_files tool call
// =============================================================================

/**
 * Maximum combined token estimate Claude can request in a single
 * read_files tool call. From the Chunk 7 design.
 *
 * Roughly equates to 300 pages of dense legal text. Comfortably fits
 * the typical "compare three pleadings" workflow. Hitting it usually
 * means Claude is over-reading; the tool returns an error message
 * Claude can surface to the lawyer ("ask a narrower question").
 *
 * Cost at this cap (uncached, Sonnet 4.6, current pricing):
 *   - First read in a 5-min window:  ~$0.30 input cost from files
 *   - Cached follow-up reads:        ~$0.03 input cost from files
 *
 * Adjust here and the cap moves everywhere — the tool route, the system
 * prompt's mention of the cap, and any UI explainers.
 */
export const MAX_READ_TOKENS_PER_TURN = 100_000;

// =============================================================================
// Token estimation
// =============================================================================
//
// We need to estimate how many tokens a file will consume BEFORE sending
// it to Anthropic, so the read_files tool can enforce the cap.
//
// Two viable approaches:
//
//   1. Call Anthropic's countTokens() endpoint with the file attached.
//      Most accurate, but costs a round trip per file per read attempt.
//      Anthropic doesn't charge for countTokens but it's still latency.
//
//   2. Heuristic estimate from byte size + page count. Less accurate
//      but fast. For files we accept (PDFs <= 100 pages, ~10MB max),
//      the heuristic is plenty accurate enough for cap enforcement.
//
// We go with #2. The heuristic is:
//
//   - PDFs: ~300 tokens per page (industry rule of thumb for dense text)
//   - Plain text: ~1 token per 4 characters (Anthropic's stated average)
//   - DOCX: treat as text but with a 1.2x multiplier (formatting overhead)
//
// Heuristic is intentionally PESSIMISTIC (overestimates) so we err
// toward refusing borderline cases rather than letting them through.

const TOKENS_PER_PDF_PAGE = 300;
const TOKENS_PER_CHAR_TEXT = 0.25;
const DOCX_MULTIPLIER = 1.2;

/**
 * Estimates the token count of a file's contents.
 *
 * @param file Minimal file info — we need MIME type, page count (for PDFs),
 *             and file size (for text/docx fallback).
 *
 * For PDFs without a known page count (Chunk 6 extraction can fail on
 * encrypted/corrupted PDFs), we fall back to the text heuristic at
 * 1.5x multiplier as an extra safety margin.
 *
 * Always returns a positive integer.
 */
export function tokenEstimate(file: {
  mimeType: string;
  pageCount: number | null;
  fileSize: number; // bytes
}): number {
  if (file.mimeType === 'application/pdf') {
    if (file.pageCount && file.pageCount > 0) {
      return Math.ceil(file.pageCount * TOKENS_PER_PDF_PAGE);
    }
    // PDF with unknown page count — fall back to size-based estimate
    // with a safety multiplier. PDFs are ~1KB per page of dense text.
    return Math.ceil((file.fileSize / 1) * TOKENS_PER_CHAR_TEXT * 1.5);
  }

  if (
    file.mimeType ===
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return Math.ceil(file.fileSize * TOKENS_PER_CHAR_TEXT * DOCX_MULTIPLIER);
  }

  // text/plain
  return Math.ceil(file.fileSize * TOKENS_PER_CHAR_TEXT);
}

// =============================================================================
// System prompt rendering limits
// =============================================================================
//
// To keep the system prompt bounded for matters with very many files,
// we cap the listing at 50 files. Sort order is most-recently-updated
// first, so the lawyer's recent work is always represented.
//
// If a matter has >50 files, the prompt includes a footer saying so.
// Claude can still call read_files for files NOT in the visible list —
// the server resolves by name and applies all the usual checks.

export const MAX_FILES_IN_SYSTEM_PROMPT = 50;

// =============================================================================
// AI Access state — derived
// =============================================================================
//
// The actual "is Claude allowed to read files right now?" question
// depends on two columns (mode + committed_at), not just mode.
//
//   - mode = 'off':                            no access
//   - mode != 'off' AND committed_at IS NULL:  pending — no access yet
//   - mode != 'off' AND committed_at IS NOT NULL: access granted
//
// This helper is the canonical check; use it everywhere instead of
// inlining the logic.

export function isAiAccessActive(matter: {
  aiAccessMode: AiAccessMode;
  aiAccessCommittedAt: Date | string | null;
}): boolean {
  if (matter.aiAccessMode === 'off') return false;
  if (matter.aiAccessCommittedAt === null) return false;
  return true;
}

/**
 * Reason string for why AI access isn't active. Used by the chat route
 * to construct error messages Claude can surface. Returns null when
 * access IS active.
 */
export function whyNotAiAccessActive(matter: {
  aiAccessMode: AiAccessMode;
  aiAccessCommittedAt: Date | string | null;
}): string | null {
  if (matter.aiAccessMode === 'off') {
    return 'AI access is off for this case. Enable it in the Files tab to let me read files.';
  }
  if (matter.aiAccessCommittedAt === null) {
    return 'AI access settings haven\u2019t been confirmed for this case yet. Open the Files tab and confirm to let me read files.';
  }
  return null;
}
