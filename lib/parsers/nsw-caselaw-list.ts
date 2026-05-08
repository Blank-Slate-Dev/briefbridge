// lib/parsers/nsw-caselaw-list.ts
//
// Parses NSW Caselaw search/browse result pages and extracts judgment URLs +
// preview metadata.
//
// Input: HTML of a page like:
//   https://www.caselaw.nsw.gov.au/search/advanced?courts=...&startDate=01/01/2026&endDate=...
// Output:
//   - results[]: each result has its decision URL plus the preview metadata
//     visible on the list page (citation, judges, decision date, catchwords)
//   - totalResults: total number of matching results across ALL pages
//   - hasNextPage: whether there are more pages after this one
//   - nextPageUrl: full URL of the next page (or null)
//
// The preview metadata we capture here is "free" — we get it without fetching
// the individual judgment page. We use it to:
//   1. Display informative progress logs ("[245/900] R v Smith [2026] NSWSC 200")
//   2. Pre-populate fields if a fetch fails (we still have the citation etc.)
//   3. Skip ingestion of "Decision restricted" entries (no useful content)
//
// IMPORTANT: NSW Caselaw's HTML uses semantic but not heavily-classed markup.
// The selectors below were derived from inspection of the rendered structure.
// If this parser starts failing, the most likely cause is the site changing
// its markup. Run the script with `--dump-list-html` to dump a list page to disk
// for inspection.

import * as cheerio from 'cheerio';

export interface ListResult {
  /** Full URL to the judgment, e.g. https://www.caselaw.nsw.gov.au/decision/abc123... */
  sourceUrl: string;
  /** The 24-char hex ID from the URL — useful as a stable key. */
  sourceId: string;
  /** Case name including citation, as displayed on the list. May be "Decision restricted". */
  caseNameWithCitation: string | null;
  /** Just the citation, e.g. '[2026] NSWSC 280'. */
  citation: string | null;
  /** Just the case name (the citation stripped out). */
  caseName: string | null;
  /** Catchwords text from the list preview (truncated by NSW Caselaw on long ones). */
  catchwords: string | null;
  /** Judge names as listed; multiple judges joined by ', '. */
  judges: string | null;
  /** Decision date as ISO date string (YYYY-MM-DD), or null if unparseable. */
  decisionDate: string | null;
  /** True if this is a restricted decision (won't have useful content to ingest). */
  isRestricted: boolean;
}

export interface ListPageResult {
  results: ListResult[];
  /** Total result count from the page header (e.g. "1 - 200 out of 124863 results"). */
  totalResults: number | null;
  /** True if there's a next page link visible. */
  hasNextPage: boolean;
  /** Full URL of the next page, ready to fetch. */
  nextPageUrl: string | null;
  /** The current page number (1-indexed). */
  currentPage: number | null;
  /** Total pages available. */
  totalPages: number | null;
}

const DECISION_URL_RE = /\/decision\/([a-f0-9]{24})/i;
const CITATION_IN_TITLE_RE = /\[(\d{4})\]\s+([A-Z]+)\s+(\d+)/;

/**
 * Parses one search/browse result page.
 *
 * @param html - the raw HTML of the page
 * @param baseUrl - the URL the page came from, used to resolve relative links
 *                  (e.g. "https://www.caselaw.nsw.gov.au/search/advanced?...")
 */
export function parseListPage(html: string, baseUrl: string): ListPageResult {
  const $ = cheerio.load(html);

  // ---------------------------------------------------------------------------
  // 1. Extract individual results.
  //
  // Each result in the rendered HTML has the structure:
  //   <h4><a href="/decision/<id>">Case name [citation]</a></h4>
  //   <div>... catchwords block ...</div>
  //   <ul>... judge / decision date list ...</ul>
  //
  // Different NSW Caselaw layouts may use h3 instead of h4. We look for ANY
  // anchor pointing at /decision/ and walk back to its containing block,
  // which is more robust against minor markup changes.
  // ---------------------------------------------------------------------------

  const seenIds = new Set<string>();
  const results: ListResult[] = [];

  $('a[href*="/decision/"]').each((_i, anchor) => {
    const $a = $(anchor);
    const href = $a.attr('href') || '';
    const match = href.match(DECISION_URL_RE);
    if (!match) return;

    const sourceId = match[1].toLowerCase();
    if (seenIds.has(sourceId)) return; // skip duplicates within page
    seenIds.add(sourceId);

    const sourceUrl = href.startsWith('http')
      ? href
      : `https://www.caselaw.nsw.gov.au${href.startsWith('/') ? '' : '/'}${href}`;

    const caseNameWithCitation = $a.text().trim() || null;
    const isRestricted = !!caseNameWithCitation?.startsWith('Decision restricted');

    // Split "Case name [year] COURT n" into name and citation.
    let caseName: string | null = null;
    let citation: string | null = null;
    if (caseNameWithCitation) {
      const cMatch = caseNameWithCitation.match(CITATION_IN_TITLE_RE);
      if (cMatch) {
        citation = cMatch[0];
        caseName = caseNameWithCitation.slice(0, cMatch.index).trim() || null;
      } else {
        caseName = caseNameWithCitation;
      }
    }

    // Walk up to the containing result block. NSW Caselaw nests each result in
    // its own div. Climb until we find a block that contains BOTH the link and
    // the judge/date metadata (which is in a sibling list).
    const $block = findResultBlock($, $a);

    const catchwords = extractCatchwords($, $block);
    const judges = extractJudges($, $block);
    const decisionDate = extractDecisionDate($, $block);

    results.push({
      sourceUrl,
      sourceId,
      caseNameWithCitation,
      citation,
      caseName,
      catchwords,
      judges,
      decisionDate,
      isRestricted,
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Total result count + current page.
  //
  // NSW Caselaw renders pagination via JavaScript. The raw HTML contains a
  // `var paginationConfig = { totalElements: N, pageNumber: P, ... };` block
  // which is the authoritative source. We extract those values directly.
  //
  // We also keep the text-based fallback ("Displaying 1 - 200 out of 124863
  // results") for compatibility with /browse and any other layout that might
  // surface this text directly.
  // ---------------------------------------------------------------------------

  let totalResults: number | null = null;
  let currentPage: number | null = null;
  let totalPages: number | null = null;
  let pageSizeFromConfig: number | null = null;

  // Primary: extract from embedded paginationConfig.
  const configMatch = html.match(
    /paginationConfig\s*=\s*\{[\s\S]*?totalElements\s*:\s*(\d+)[\s\S]*?pageNumber\s*:\s*(\d+)[\s\S]*?\}/,
  );
  if (configMatch) {
    totalResults = parseInt(configMatch[1], 10);
    currentPage = parseInt(configMatch[2], 10);
    // The actual results-per-page used by NSW Caselaw on /search/advanced is
    // 20. We measure it from the actual results count to avoid hardcoding.
    pageSizeFromConfig = results.length > 0 ? results.length : 20;
    totalPages = Math.ceil(totalResults / pageSizeFromConfig);
  } else {
    // Fallback: text-based parsing for /browse-style pages.
    const bodyText = $('body').text();
    const totalMatch = bodyText.match(/out of\s+(\d[\d,]*)\s+results/i);
    if (totalMatch) {
      totalResults = parseInt(totalMatch[1].replace(/,/g, ''), 10);
    }

    const rangeMatch = bodyText.match(/Displaying\s+(\d+)\s*[-–]\s*(\d+)/i);
    if (rangeMatch && totalResults !== null) {
      const rangeStart = parseInt(rangeMatch[1], 10);
      const rangeEnd = parseInt(rangeMatch[2], 10);
      const pageSize = rangeEnd - rangeStart + 1;
      currentPage = Math.floor((rangeStart - 1) / pageSize) + 1;
      totalPages = Math.ceil(totalResults / pageSize);
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Next page link.
  //
  // Because pagination on NSW Caselaw is JavaScript-rendered, no <a rel="next">
  // or "Next" link exists in the raw HTML. We construct the next page URL
  // ourselves by incrementing the `page` parameter.
  //
  // We still check for an explicit next-link first as a safety net for any
  // layouts where the link IS in the HTML.
  // ---------------------------------------------------------------------------

  let nextPageUrl: string | null = null;
  const $nextRel = $('a[rel="next"]').first();
  if ($nextRel.length) {
    nextPageUrl = absoluteUrl($nextRel.attr('href'), baseUrl);
  } else {
    const $nextText = $('a').filter((_i, el) => {
      const text = $(el).text().trim().toLowerCase();
      return text === 'next' || text === '›' || text === '>' || text === 'next ›';
    }).first();
    if ($nextText.length) {
      nextPageUrl = absoluteUrl($nextText.attr('href'), baseUrl);
    }
  }

  // Primary path: build the next page URL by setting the `page` parameter.
  //
  // NSW Caselaw uses 0-indexed `?page=N` URL parameters but its embedded
  // paginationConfig reports 1-indexed `pageNumber`. So:
  //   - First page (no `?page=`)      → server reports pageNumber: 1
  //   - Next page is `?page=1`        → server reports pageNumber: 2
  //   - Next page is `?page=2`        → server reports pageNumber: 3
  // Therefore the 0-indexed value to use for the NEXT request equals the
  // current 1-indexed `pageNumber`.
  if (!nextPageUrl && currentPage !== null && totalPages !== null && currentPage < totalPages) {
    nextPageUrl = setPageParam(baseUrl, currentPage);
  }

  return {
    results,
    totalResults,
    hasNextPage: nextPageUrl !== null,
    nextPageUrl,
    currentPage,
    totalPages,
  };
}

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Walks up from the result anchor until we find a parent block that also
 * contains the judge/date metadata. We bound the walk to 6 levels — if we
 * haven't found a sensible block by then, the markup has probably changed.
 */
function findResultBlock(
  $: cheerio.CheerioAPI,
  $anchor: cheerio.Cheerio<any>,
): cheerio.Cheerio<any> {
  let $current = $anchor.parent();
  for (let i = 0; i < 6; i++) {
    // The block we want contains a "Decision date" label OR a "Judgment of" label.
    const text = $current.text();
    if (/Decision date/i.test(text) && /Judgment of/i.test(text)) {
      return $current;
    }
    if (!$current.parent().length) break;
    $current = $current.parent();
  }
  // Fall back to the immediate parent.
  return $anchor.parent();
}

function extractCatchwords(
  $: cheerio.CheerioAPI,
  $block: cheerio.Cheerio<any>,
): string | null {
  // The label "Catchwords:" appears in a <strong> tag, with the catchwords
  // text in the following text node or sibling element.
  const $label = $block.find('strong, b').filter((_i, el) =>
    /^Catchwords:?\s*$/i.test($(el).text().trim()),
  ).first();

  if (!$label.length) return null;

  // The text after the label can be in a sibling element OR in the same parent
  // as following text. We grab the parent's text and strip the label.
  const $labelParent = $label.parent();
  const fullText = $labelParent.text();
  const stripped = fullText.replace(/^\s*Catchwords:?\s*/i, '').trim();

  if (stripped.length > 0 && stripped.length < 5000) {
    return stripped;
  }

  // Fallback: try the next sibling of the label element itself.
  const sibling = $label[0]?.nextSibling;
  if (sibling && 'data' in sibling && typeof sibling.data === 'string') {
    return sibling.data.trim() || null;
  }
  const $nextEl = $label.next();
  if ($nextEl.length) {
    return $nextEl.text().trim() || null;
  }

  return null;
}

function extractJudges(
  $: cheerio.CheerioAPI,
  $block: cheerio.Cheerio<any>,
): string | null {
  // The structure is roughly:
  //   <ul>
  //     <li><strong>Judgment of</strong></li>
  //     <li>Justice Smith J<br>Justice Jones J</li>
  //     <li><strong>Decision date</strong></li>
  //     <li>27 March 2026</li>
  //   </ul>
  // We find the "Judgment of" label and grab the next <li>.
  const $label = $block.find('strong, b').filter((_i, el) =>
    /^Judgment of:?\s*$/i.test($(el).text().trim()),
  ).first();

  if (!$label.length) return null;

  const $li = $label.closest('li');
  if (!$li.length) return null;

  const $valueLi = $li.next('li');
  if (!$valueLi.length) return null;

  // Multiple judges may be separated by <br> or by separate text nodes.
  // We replace <br> with ', ' and collapse whitespace.
  const html = $valueLi.html() || '';
  const text = html
    .replace(/<br\s*\/?>/gi, ', ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*,/g, ',')
    .replace(/,\s*$/, '')
    .trim();

  return text || null;
}

function extractDecisionDate(
  $: cheerio.CheerioAPI,
  $block: cheerio.Cheerio<any>,
): string | null {
  const $label = $block.find('strong, b').filter((_i, el) =>
    /^Decision date:?\s*$/i.test($(el).text().trim()),
  ).first();

  if (!$label.length) return null;

  const $li = $label.closest('li');
  if (!$li.length) return null;

  const $valueLi = $li.next('li');
  if (!$valueLi.length) return null;

  const text = $valueLi.text().trim();
  return parseDateToISO(text);
}

/** "27 March 2026" → "2026-03-27"  |  "27/03/2026" → "2026-03-27"  |  bad → null */
function parseDateToISO(input: string): string | null {
  if (!input) return null;
  const trimmed = input.trim();

  const slash = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (slash) {
    const [, d, m, y] = slash;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const months: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };
  const wordy = trimmed.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (wordy) {
    const [, d, monthName, y] = wordy;
    const m = months[monthName.toLowerCase()];
    if (!m) return null;
    return `${y}-${String(m).padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  return null;
}

function absoluteUrl(href: string | undefined, baseUrl: string): string | null {
  if (!href) return null;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return null;
  }
}

/** Sets the `page` query parameter on a URL to a specific value. */
function setPageParam(url: string, page: number): string {
  const u = new URL(url);
  u.searchParams.set('page', String(page));
  return u.href;
}