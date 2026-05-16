// lib/legislation/fetch.ts
//
// Multi-document HTML fetcher for legislation.gov.au Acts.
//
// =============================================================================
// WHY THIS EXISTS
// =============================================================================
//
// legislation.gov.au publishes each Act's EPUB content split across one or
// more HTML documents under predictable URL paths:
//
//   .../OEBPS/document_1/document_1.html
//   .../OEBPS/document_2/document_2.html
//   .../OEBPS/document_3/document_3.html
//   ...
//
// Small Acts (Privacy Act, AIA, AIC) fit in document_1. Large Acts span
// multiple documents: Fair Work Act 2009 spans 4. Until this module, the
// pipeline fetched only document_1 — silently truncating large Acts. The
// verifier passed because the DB matched what we fetched, but what we
// fetched was incomplete.
//
// This module probes documents in order until a 404, concatenates them
// into a single logical HTML stream, and returns the combined HTML. The
// parser then walks <p> elements as if they came from one document.
//
// =============================================================================
// COMBINATION STRATEGY
// =============================================================================
//
// Naively concatenating raw HTML produces malformed markup (multiple
// <html>, <head>, <body> tags). Instead we parse each document with
// cheerio, extract its <body> children, and assemble a single wrapper:
//
//   <html><body>{doc1 body children}{doc2 body children}...</body></html>
//
// The parser only inspects <p> elements via cheerio queries — it doesn't
// care about the outer envelope — so this is transparent.
//
// =============================================================================
// METADATA NOTE
// =============================================================================
//
// The parser's compilation-date/number extraction runs over the first 100
// <p> elements. Those metadata lines live at the top of document_1, so
// they remain in the first 100 elements of the combined HTML. If
// legislation.gov.au ever moves metadata into a separate document or
// pushes it past the 100-element window, this would silently break —
// flag for future hardening.
//
// =============================================================================
// SOURCE-OF-TRUTH URL
// =============================================================================
//
// The discovery rule is intentionally strict:
//   - document_N exists if GET returns 200 with non-empty body
//   - document_N does NOT exist if GET returns any non-200 status
//   - on first non-existence, stop probing (no gaps assumed)
//
// HEAD requests on this server can return misleading 405 codes, so we
// always use GET. This means each probe fetches the full document, which
// is fine — we'd need the body anyway if it exists.

import * as cheerio from 'cheerio';

// =============================================================================
// Configuration
// =============================================================================

const USER_AGENT =
  'Mozilla/5.0 (compatible; BriefBridge legislation; +https://briefbridge.com)';

// Hard cap on document count. If an Act somehow has more than this many
// documents, we bail rather than risk an infinite loop. Tax Acts and
// Corporations Act are large but not THAT large.
const MAX_DOCUMENTS = 50;

// =============================================================================
// URL building
// =============================================================================

/**
 * Build the URL for a specific document of an Act compilation.
 *
 * Pattern:
 *   https://www.legislation.gov.au/{registrationId}/{date}/{date}/text/original/epub/OEBPS/document_{n}/document_{n}.html
 */
export function buildActUrl(
  registrationId: string,
  compilationDate: string,
  documentNumber: number,
): string {
  return (
    `https://www.legislation.gov.au/${registrationId}/${compilationDate}/` +
    `${compilationDate}/text/original/epub/OEBPS/document_${documentNumber}/` +
    `document_${documentNumber}.html`
  );
}

// =============================================================================
// Fetching
// =============================================================================

/**
 * Fetch a single document's HTML. Returns null if the document doesn't
 * exist (any non-200 response). Returns the body text otherwise.
 */
async function fetchOneDocument(url: string): Promise<string | null> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    return null;
  }
  const text = await res.text();
  // Sanity: zero-byte 200 is treated as nonexistent.
  if (text.length === 0) {
    return null;
  }
  return text;
}

// =============================================================================
// Body extraction + combination
// =============================================================================

/**
 * Extract the inner HTML of <body> from a document. If for some reason
 * the document has no <body> (malformed source), return the full HTML
 * unchanged — better to over-include than drop content silently.
 */
function extractBodyContents(documentHtml: string): string {
  const $ = cheerio.load(documentHtml);
  const body = $('body');
  if (body.length === 0) {
    return documentHtml;
  }
  return body.html() ?? '';
}

/**
 * Combine multiple documents' body contents into a single well-formed
 * HTML string suitable for re-parsing with cheerio.
 */
function combineDocuments(documents: string[]): string {
  const bodies = documents.map(extractBodyContents).join('\n');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${bodies}</body></html>`;
}

// =============================================================================
// Public entry point
// =============================================================================

export interface FetchResult {
  /** Combined HTML stream from all documents, ready for the parser. */
  html: string;
  /** Per-document metadata: URL, original bytes. Useful for diagnostics. */
  documents: Array<{ documentNumber: number; url: string; bytes: number }>;
  /** Total bytes across all source documents (before combination). */
  totalSourceBytes: number;
}

/**
 * Fetch ALL document_N.html files for an Act, in order, until one
 * returns a non-200 response. Returns the combined HTML plus per-document
 * diagnostic metadata.
 *
 * Side effect: logs to stderr as it fetches, so the caller's user sees
 * progress on slow Acts.
 *
 * Throws if document_1 doesn't exist (an Act must have at least one
 * document — a missing document_1 is a real error worth surfacing) or
 * if the probe hits the MAX_DOCUMENTS hard cap.
 */
export async function fetchActHtml(
  registrationId: string,
  compilationDate: string,
): Promise<FetchResult> {
  const documents: FetchResult['documents'] = [];
  const rawHtmlByDocument: string[] = [];

  for (let n = 1; n <= MAX_DOCUMENTS; n++) {
    const url = buildActUrl(registrationId, compilationDate, n);
    console.error(`[fetch] document_${n}: ${url}`);
    const html = await fetchOneDocument(url);
    if (html === null) {
      // Stop on first non-existent document.
      if (n === 1) {
        throw new Error(
          `Cannot fetch ${url} — document_1 must exist for any valid Act. ` +
            `Check the registration ID and compilation date.`,
        );
      }
      console.error(
        `[fetch] document_${n} not found — stopping. Fetched ${n - 1} document(s).`,
      );
      break;
    }
    console.error(`[fetch] document_${n}: ${html.length.toLocaleString()} bytes`);
    documents.push({ documentNumber: n, url, bytes: html.length });
    rawHtmlByDocument.push(html);

    if (n === MAX_DOCUMENTS) {
      throw new Error(
        `Hit MAX_DOCUMENTS=${MAX_DOCUMENTS} while fetching ${registrationId}. ` +
          `Bailing rather than risk an infinite loop. If the Act genuinely has more ` +
          `than ${MAX_DOCUMENTS} documents, raise the cap.`,
      );
    }
  }

  const combined = combineDocuments(rawHtmlByDocument);
  const totalSourceBytes = documents.reduce((sum, d) => sum + d.bytes, 0);

  console.error(
    `[fetch] combined ${documents.length} document(s), ${totalSourceBytes.toLocaleString()} ` +
      `source bytes → ${combined.length.toLocaleString()} combined bytes`,
  );

  return {
    html: combined,
    documents,
    totalSourceBytes,
  };
}