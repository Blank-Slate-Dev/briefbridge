// lib/parsers/hca-austlii-list.ts
//
// Parses an AustLII High Court year-index (table of contents) page and
// extracts each judgment's URL + preview metadata.
//
// Parallel to lib/parsers/nsw-caselaw-list.ts, but far simpler: AustLII's
// year index is a single static HTML page (no JS pagination) listing every
// HCA decision for that year, grouped by month.
//
// Input HTML (verified against the real page, Feb 2026):
//   https://www.austlii.edu.au/cgi-bin/viewtoc/au/cases/cth/HCA/2024/
//
// Structure observed:
//   <div class="all-section" id="2024-02">
//     <h2 class="card-title">February 2024</h2>
//     <div class="card">
//       <ul>
//         <li data-count="1.">
//           <a href="/cgi-bin/viewdoc/au/cases/cth/HCA/2024/1.html">
//             Harvey v Minister for Primary Industry and Resources
//             [2024] HCA 1 (7 February 2024)
//           </a>
//         </li>
//         ...
//
// The link text carries everything we need for a preview: case name,
// citation, and the decision date in parentheses. We parse all three so
// progress logs are informative and so a failed fetch still leaves us the
// citation.

import * as cheerio from 'cheerio';

const AUSTLII_ORIGIN = 'https://www.austlii.edu.au';

// A judgment link on the index looks like:
//   /cgi-bin/viewdoc/au/cases/cth/HCA/2024/1.html
// The trailing segment (1) is the AustLII decision number for that year.
const HCA_DOC_HREF_RE =
  /\/cgi-bin\/viewdoc\/au\/cases\/cth\/HCA\/(\d{4})\/(\d+)\.html/i;

// The citation embedded in link text: "[2024] HCA 1".
const HCA_CITATION_RE = /\[(\d{4})\]\s+HCA\s+(\d+)/;

// The date in parentheses at the end of the link text: "(7 February 2024)".
const HCA_DATE_RE = /\((\d{1,2}\s+[A-Za-z]+\s+\d{4})\)\s*$/;

export interface HcaListResult {
  /** Full URL to the judgment on AustLII. */
  sourceUrl: string;
  /**
   * A stable source key for this judgment: 'hca-YYYY-N' where N is the
   * AustLII decision number. Distinct from the citation (which is the same
   * numbers but formatted differently) and safe to use as a dedup key.
   */
  sourceId: string;
  /** The full link text, e.g. 'Harvey v ... [2024] HCA 1 (7 February 2024)'. */
  rawTitle: string;
  /** Just the citation, e.g. '[2024] HCA 1'. */
  citation: string | null;
  /** Just the case name (citation + trailing date stripped). */
  caseName: string | null;
  /** Decision date as ISO (YYYY-MM-DD), or null if unparseable. */
  decisionDate: string | null;
}

export interface HcaIndexResult {
  /** The year this index page covers (from the URL / first citation). */
  year: number | null;
  /** All judgments found on the page, in document order. */
  results: HcaListResult[];
}

/**
 * Parse an AustLII HCA year-index page.
 *
 * @param html    raw HTML of the year TOC page
 * @param baseUrl the URL the page came from (for resolving relative links)
 */
export function parseHcaIndexPage(html: string, baseUrl: string): HcaIndexResult {
  const $ = cheerio.load(html);

  const seen = new Set<string>();
  const results: HcaListResult[] = [];
  let year: number | null = null;

  $('a[href*="/cases/cth/HCA/"]').each((_i, anchor) => {
    const $a = $(anchor);
    const href = $a.attr('href') || '';
    const hrefMatch = href.match(HCA_DOC_HREF_RE);
    if (!hrefMatch) return; // not a judgment doc link (could be nav)

    const linkYear = parseInt(hrefMatch[1], 10);
    const decisionNo = hrefMatch[2];
    const sourceId = `hca-${linkYear}-${decisionNo}`;
    if (seen.has(sourceId)) return;
    seen.add(sourceId);

    if (year === null) year = linkYear;

    const sourceUrl = href.startsWith('http')
      ? href
      : `${AUSTLII_ORIGIN}${href.startsWith('/') ? '' : '/'}${href}`;

    const rawTitle = $a.text().replace(/\s+/g, ' ').trim();

    // Citation.
    let citation: string | null = null;
    const cMatch = rawTitle.match(HCA_CITATION_RE);
    if (cMatch) citation = cMatch[0];

    // Decision date (trailing parenthesised date).
    let decisionDate: string | null = null;
    const dMatch = rawTitle.match(HCA_DATE_RE);
    if (dMatch) decisionDate = parseDateToISO(dMatch[1]);

    // Case name = everything before the citation.
    let caseName: string | null = null;
    if (cMatch && typeof cMatch.index === 'number') {
      caseName = rawTitle.slice(0, cMatch.index).trim() || null;
    } else {
      // No citation in text — strip a trailing date if present, else whole.
      caseName = rawTitle.replace(HCA_DATE_RE, '').trim() || null;
    }

    results.push({
      sourceUrl,
      sourceId,
      rawTitle,
      citation,
      caseName,
      decisionDate,
    });
  });

  return { year, results };
}

/** Build the AustLII HCA year-index URL for a given year. */
export function buildHcaIndexUrl(year: number): string {
  return `${AUSTLII_ORIGIN}/cgi-bin/viewtoc/au/cases/cth/HCA/${year}/`;
}

/** "7 February 2024" -> "2024-02-07"  |  bad input -> null */
function parseDateToISO(input: string): string | null {
  const trimmed = input.trim();
  const months: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };
  const m = trimmed.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return null;
  const day = m[1];
  const month = months[m[2].toLowerCase()];
  const yr = m[3];
  if (!month) return null;
  return `${yr}-${String(month).padStart(2, '0')}-${day.padStart(2, '0')}`;
}