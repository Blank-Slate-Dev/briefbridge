// lib/chat/citations.ts
//
// Parses inline file citations out of Claude's response text.
//
// Citation format (from the Chunk 7 design + system prompt instructions):
//
//   > "exact quoted text from the file"
//   > — filename.pdf, p.3
//
// The leading "> " is markdown blockquote syntax — Claude is instructed
// to wrap each quote in a blockquote with the source line below it.
//
// Our job here: find these patterns in Claude's text after streaming
// completes, extract them as structured FileCitation rows, return both
// the cleaned text AND the citations.
//
// Why parse rather than ask Claude to emit JSON: the prose format is
// what renders well in markdown, and we want the citations to be part
// of the message text so they survive simple message storage / display.
// Asking Claude to output JSON OR prose makes both pathways fragile.

import type { FileCitation } from '@/lib/db/schema';

// =============================================================================
// Patterns
// =============================================================================
//
// The regex looks for, anywhere in the text:
//
//   > "....any chars including newlines..."
//   > — filename.ext, p.SOMETHING
//
// We're tolerant of:
//   - Curly quotes vs straight quotes (" " ' ')
//   - Em-dash vs hyphen vs en-dash on the source line
//   - "p.3" vs "page 3" vs "pp. 3-4"
//   - Whitespace variations
//
// We're strict about:
//   - The "> " blockquote prefix on both lines (so we don't pick up
//     random text that happens to look quote-shaped)
//   - The filename containing a "." (so we don't match generic prose)

/**
 * Match a single quote block. The regex is intentionally simple at the
 * cost of some false negatives — we'd rather miss an unusual format
 * than match something that wasn't a citation.
 *
 * Capture groups:
 *   1. quote (the content inside the first quoted line, after stripping
 *      the > prefix and the surrounding quote marks)
 *   2. filename
 *   3. page reference (the part after p./pp./page)
 */
const CITATION_REGEX =
  /(?:^|\n)>\s*["\u201C\u2018]([\s\S]+?)["\u201D\u2019]\s*\n>\s*[\u2014\u2013\-]\s*([^,\n]+\.[a-zA-Z0-9]{2,5}),?\s*p(?:p|age|ages|\.)?\s*\.?\s*([^\n]+)/gi;

// =============================================================================
// Extraction
// =============================================================================

export interface ExtractedCitation {
  filename: string;
  page: string;
  quote: string;
  /** Index in the source text where this citation starts (for ordering). */
  position: number;
}

/**
 * Find all file citations in a piece of text. Returns an ordered list
 * (in occurrence order).
 *
 * Does NOT mutate the text. The caller stores the original text plus
 * the structured citations alongside.
 */
export function extractFileCitations(text: string): ExtractedCitation[] {
  const out: ExtractedCitation[] = [];
  // Reset lastIndex each call (the regex is /g so it's stateful)
  CITATION_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = CITATION_REGEX.exec(text)) !== null) {
    const [, rawQuote, rawFilename, rawPage] = match;
    out.push({
      quote: rawQuote.trim(),
      filename: rawFilename.trim(),
      page: rawPage.trim(),
      position: match.index,
    });
  }
  return out;
}

// =============================================================================
// Hydration — pair extracted citations with file IDs
// =============================================================================
//
// After extraction we have filename strings; for storage we need file_ids.
// The chat route knows which files were actually used in this turn (from
// the files-tool response), so we look up file_id by filename from that
// list. Filenames not in the used-files list (which shouldn't happen
// if Claude is well-behaved, but might) are dropped — we don't store
// citations for files we can't link back to.

export function hydrateFileCitations(
  extracted: ExtractedCitation[],
  filesUsed: Array<{ fileId: string; filename: string }>,
  startIndex: number,
): FileCitation[] {
  const byFilename = new Map(filesUsed.map((f) => [f.filename, f.fileId]));

  const result: FileCitation[] = [];
  for (let i = 0; i < extracted.length; i++) {
    const e = extracted[i];
    const fileId = byFilename.get(e.filename);
    if (!fileId) continue;
    result.push({
      kind: 'file',
      index: startIndex + i,
      fileId,
      filename: e.filename,
      page: e.page,
      // Cap quote at 1000 chars defensively — extreme cases.
      quote: e.quote.length > 1000 ? e.quote.slice(0, 1000) + '\u2026' : e.quote,
    });
  }
  return result;
}
