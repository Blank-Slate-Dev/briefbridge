// lib/files/page-count.ts
//
// Page count extraction for uploaded PDFs.
//
// Computes how many pages a PDF has. NOTHING ELSE. Specifically:
//   - We do NOT extract text from PDFs (per the Chunk 6 design decision —
//     text extraction can silently produce garbage on scanned/imperfect
//     PDFs, and feeding garbage to Claude would damage user trust).
//   - We do NOT process DOCX or TXT — page count isn't a meaningful
//     concept for those formats in our v1 use case.
//
// IMPORTANT — pdf-lib only. Do NOT pull in pdf-parse or pdfjs-dist or
// anything else. pdf-lib reads metadata (page count, encryption flag)
// without rendering or text-extracting. Those other libraries pull text
// out as a side effect of their normal operation, which is exactly what
// we don't want.
//
// Why not just count `<</Type /Page>>` regex matches in the raw PDF bytes:
//   - PDFs can be compressed/encrypted/object-streamed in ways that hide
//     page objects from naive byte scans
//   - pdf-lib does the work properly via the official PDF spec parsing
//   - It's already the right size for this single task

import { PDFDocument } from 'pdf-lib';

/**
 * Returns the page count for a PDF buffer.
 *
 * For non-PDFs (DOCX, TXT, anything else): returns null.
 * For corrupted/encrypted PDFs that pdf-lib can't parse: returns null
 *   (caller treats as "page count unknown, assume AI-readable optimistically").
 *
 * NEVER throws. Page count is metadata enrichment — failure here must not
 * block the upload. The completeUpload action wraps this and logs failures
 * for monitoring, but the lawyer's upload still succeeds.
 *
 * @param buffer    The raw file bytes
 * @param mimeType  Used to short-circuit non-PDF inputs
 */
export async function extractPageCount(
  buffer: Buffer | Uint8Array,
  mimeType: string,
): Promise<number | null> {
  if (mimeType !== 'application/pdf') {
    return null;
  }

  try {
    // ignoreEncryption: true means pdf-lib will load encrypted PDFs but
    // refuse to modify them. We don't modify; we just want the page count.
    // Without this flag, encrypted PDFs throw immediately on load.
    //
    // updateMetadata: false skips Info dictionary touchups pdf-lib normally
    // does on load — not strictly necessary for our read-only use but saves
    // a tiny bit of work.
    const pdfDoc = await PDFDocument.load(buffer, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    return pdfDoc.getPageCount();
  } catch {
    // pdf-lib throws on:
    //   - Truly corrupted PDFs (missing %PDF header, broken xref, etc.)
    //   - Some unusual PDF variants it doesn't support
    //   - Files that claim to be PDF but aren't
    // For all of these, "page count unknown" is the correct answer.
    // Caller decides what to do (the rule in completeUpload is: set
    // ai_readable = true optimistically, defer to the actual read attempt
    // in Chunk 7 to surface a real error).
    return null;
  }
}
