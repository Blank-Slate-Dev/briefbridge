// lib/parsers/nsw-caselaw.ts
/**
 * NSW Caselaw HTML parser.
 *
 * Written against the real HTML structure of NSW Caselaw decision pages.
 * Tested against:
 *   https://www.caselaw.nsw.gov.au/decision/19dffa6432c645fbf145d0ed
 *   (Zacharatos v Western Agricultural Co Pty Ltd (No 2) [2026] NSWSC 474)
 *
 * Page structure observed (MODERN template, ~2015 onward):
 *   <title> "<case name> - NSW Caselaw"
 *   <div class="head">
 *     <h1> Court name / "New South Wales"
 *   <div class="coversheet">
 *     <dl class="dl-horizontal">
 *       <dt>Field label:</dt><dd>value</dd>
 *   <div class="body">
 *     <h1>JUDGMENT</h1>
 *     <h2><u>Section heading</u></h2>
 *     <ol class="num1" start="N">
 *       <li><p>Paragraph N text</p></li>
 *     <ol class="indent1 num2" start="1">       <-- sub-items (e.g. orders)
 *       <li><p>Sub-item text</p></li>
 *
 * LEGACY template (decisions migrated from the pre-2015 platform):
 *   Validated against:
 *   https://www.caselaw.nsw.gov.au/decision/54a640003004de94513dca94
 *   (Stankovic v Magee [2014] NSWCA 439)
 *
 *   The coversheet is IDENTICAL to the modern template (same
 *   <div class="coversheet"> / <dl> / <dt>/<dd> structure), so all
 *   metadata extraction works unchanged on legacy pages. Only the
 *   judgment body differs. Instead of <ol class="num1"> lists, the
 *   legacy body is a flat sequence of:
 *
 *     <h1 class="Judgment_Heading">Judgment</h1>
 *     <p class="Judgment_para" listID="30" listLevel="0" listString="1"
 *        listValue="1"><span class="list_number_">1</span>BASTEN JA: ...</p>
 *     <blockquote class="quote">quoted passage</blockquote>
 *     <p class="Judgment_Numbered_1_" listLevel="1" listValue="1">
 *        <span class="list_number_">(1)</span>Set aside ...</p>   <-- orders / sub-items
 *     <p>\n</p>                                                    <-- empty spacers
 *     <p style="text-align:center;">**********</p>                <-- end marker
 *     <p class="disclaimer">...</p>
 *     <p class="lastupdate ...">Decision last updated: ...</p>
 *
 *   Key facts the legacy parser relies on:
 *     - The paragraph number is carried on the listValue attribute
 *       (authoritative; no text scraping needed). HTML parsing lowercases
 *       attribute names, so we read 'listvalue' (with a 'listValue'
 *       fallback for safety).
 *     - listLevel="0" marks a top-level judgment paragraph; listLevel>=1
 *       marks a nested item (e.g. numbered orders), which we attach as a
 *       subItem of the preceding paragraph — mirroring how the modern
 *       parser attaches num2+ lists.
 *     - <span class="list_number_"> duplicates the number inside the
 *       paragraph text; we strip it so paragraph text doesn't begin
 *       "1BASTEN JA".
 *     - <blockquote class="quote"> elements are SIBLINGS of the paragraph
 *       they belong to (in the modern template quotes live inside the
 *       <li>). We append each blockquote to the preceding paragraph's
 *       text so quoted passages remain part of that paragraph for
 *       retrieval and citation.
 *
 * LOTUS template (oldest generation, ~1990s decisions):
 *   Validated against:
 *   https://www.caselaw.nsw.gov.au/decision/549f9b413004262463b16eb4
 *   (Regina v Reid [1999] NSWCCA 258)
 *
 *   Detectable by <div id="decisionDetail" class="public lotus"> (the
 *   mid-era template uses class "public netcat"). These pages have NO
 *   coversheet div at all — metadata lives in <table> rows whose label
 *   cell reads e.g. "CITATION :", "JUDGMENT DATE :", "JUDGMENT OF :",
 *   "CASES CITED:", with the value in the following <td>. The judgment
 *   body has no structural paragraph markup whatsoever: paragraph
 *   numbers are inline text of the form "1&nbsp;&nbsp;&nbsp; " followed
 *   by the paragraph, inside an inconsistent soup of nested <ul>/<font>
 *   tags (quotes appear as indented <ul> blocks).
 *
 *   Strategy: read metadata from the label tables; extract the body's
 *   text linearly and split it on the paragraph-number marker — a
 *   1-3 digit number followed by at least one non-breaking space
 *   (\u00a0), which is unique to paragraph starts in this template —
 *   with a monotonic sequence check (starts at 1; each accepted number
 *   must be within +3 of the last) so stray numbers inside the prose
 *   can't masquerade as paragraph breaks. Indented quote blocks fold
 *   naturally into their paragraph's text.
 *
 * Dispatch: parseNswJudgment tries the modern parser first; if it yields
 * zero paragraphs, it falls back to the mid-era legacy parser; if THAT
 * yields zero, it falls back to the Lotus text-split parser. Coversheet
 * fields likewise fall back to the Lotus label tables when the modern
 * coversheet is absent. The modern and mid-era paths are untouched, so
 * existing ingestion behaviour cannot regress.
 */

import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';

export interface SubItem {
  number: number;
  text: string;
  level: number; // 2 for num2 (most common), 3+ for deeper nesting
}

export interface Paragraph {
  number: number;
  text: string;
  heading?: string;
  subItems?: SubItem[];
}

export interface CitedCase {
  name: string;
  citation: string;
  raw: string;
}

export interface CitedLegislation {
  title: string;
  sections?: string;
  raw: string;
}

export interface ParsedJudgment {
  citation: string | null;
  caseName: string | null;
  court: string | null;
  jurisdiction: string | null;
  decisionDate: string | null;
  hearingDates: string | null;
  judges: string[];
  parties: string | null;
  representation: string | null;
  fileNumbers: string[];
  category: string | null;
  catchwords: string | null;
  decisionSummary: string | null;
  casesCited: CitedCase[];
  legislationCited: CitedLegislation[];
  paragraphs: Paragraph[];
  fullText: string;
  paragraphCount: number;
  publicationRestriction: string | null;
  suppressionDetected: boolean;
  decisionLastUpdated: string | null;
  sourceId: string | null;
}

function getCoversheetField($: CheerioAPI, labelText: string): string | null {
  const dt = $('.coversheet dl dt')
    .filter((_, el) => $(el).text().trim().toLowerCase() === labelText.toLowerCase())
    .first();
  if (!dt.length) return null;
  const dd = dt.next('dd');
  if (!dd.length) return null;
  const text = dd.text().replace(/\s+/g, ' ').trim();
  return text || null;
}

function getCoversheetFieldRaw($: CheerioAPI, labelText: string): string | null {
  const dt = $('.coversheet dl dt')
    .filter((_, el) => $(el).text().trim().toLowerCase() === labelText.toLowerCase())
    .first();
  if (!dt.length) return null;
  const dd = dt.next('dd');
  if (!dd.length) return null;

  const paragraphs = dd.find('p');
  if (paragraphs.length > 0) {
    const lines: string[] = [];
    paragraphs.each((_, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      if (text) lines.push(text);
    });
    if (lines.length > 0) return lines.join('\n');
  }

  const lines: string[] = [];
  let buffer = '';
  dd.contents().each((_, node) => {
    if (node.type === 'text') {
      buffer += node.data;
    } else if (node.type === 'tag') {
      const tag = node.tagName?.toLowerCase();
      if (tag === 'br') {
        const trimmed = buffer.replace(/\s+/g, ' ').trim();
        if (trimmed) lines.push(trimmed);
        buffer = '';
      } else {
        buffer += $(node).text();
      }
    }
  });
  const finalTrimmed = buffer.replace(/\s+/g, ' ').trim();
  if (finalTrimmed) lines.push(finalTrimmed);

  if (lines.length > 0) return lines.join('\n');
  const fallback = dd.text().replace(/\s+/g, ' ').trim();
  return fallback || null;
}

function parseCitation(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(/\[\d{4}\]\s+[A-Z]{2,8}\s+\d+/);
  return match ? match[0] : text.trim() || null;
}

function parseDecisionDate(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (!match) return null;
  const [, day, monthName, year] = match;
  const months: Record<string, number> = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  };
  const monthIdx = months[monthName.toLowerCase()];
  if (monthIdx === undefined) return null;
  const date = new Date(Date.UTC(Number(year), monthIdx, Number(day)));
  return date.toISOString().split('T')[0];
}

function parseJudges(beforeField: string | null): string[] {
  if (!beforeField) return [];
  return beforeField.split(/[,;]| and /).map((s) => s.trim()).filter(Boolean);
}

function parseCourt($: CheerioAPI, citation: string | null): string | null {
  const headH1 = $('div.head h1').first();
  if (headH1.length) {
    const text = headH1.text().replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  if (citation) {
    const map: Record<string, string> = {
      NSWSC: 'Supreme Court of NSW',
      NSWCA: 'NSW Court of Appeal',
      NSWCCA: 'NSW Court of Criminal Appeal',
      NSWDC: 'NSW District Court',
      NSWLEC: 'NSW Land and Environment Court',
      NSWCATAD: 'NSW Civil and Administrative Tribunal — Administrative & Equal Opportunity',
      NSWCATCD: 'NSW Civil and Administrative Tribunal — Consumer & Commercial',
      NSWCATGD: 'NSW Civil and Administrative Tribunal — Guardianship',
      NSWCATOD: 'NSW Civil and Administrative Tribunal — Occupational',
      NSWLC: 'NSW Local Court',
    };
    for (const [code, name] of Object.entries(map)) {
      if (citation.includes(code)) return name;
    }
  }
  return null;
}

function parseCasesCited(raw: string | null): CitedCase[] {
  if (!raw) return [];
  return raw.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const mncMatch = line.match(/^(.+?)\s+(\[\d{4}\]\s+[A-Z]{2,8}\s+\d+.*)$/);
    const reportedMatch = line.match(/^(.+?)\s+(\(\d{4}\)\s+\d+\s+[A-Z]+\s+\d+.*)$/);
    const match = mncMatch || reportedMatch;
    if (match) return { name: match[1].trim(), citation: match[2].trim(), raw: line };
    return { name: line, citation: '', raw: line };
  });
}

function parseLegislationCited(raw: string | null): CitedLegislation[] {
  if (!raw) return [];
  return raw.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const sectionMatch = line.match(/^(.+?)\s+(?:s|ss|r|rr|sch|pt)\s+(.+)$/i);
    if (sectionMatch) return { title: sectionMatch[1].trim(), sections: sectionMatch[2].trim(), raw: line };
    return { title: line, raw: line };
  });
}

function parseParagraphs($: CheerioAPI): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let currentHeading: string | undefined = undefined;

  // Walk the body in document order. We pick up:
  //  - <h2> as section headings (Background / Costs / Orders / etc.)
  //  - <ol class="num1"> as top-level numbered paragraphs
  //  - <ol class="num2"> (or num3+) as sub-items, attached to the most
  //    recently-added paragraph. NSW Caselaw uses these for orders, sub-clauses,
  //    enumerated holdings, etc.
  const body = $('div.body').first();
  if (!body.length) return paragraphs;

  body.children().each((_, el) => {
    const $el = $(el);
    const tag = el.tagName?.toLowerCase();

    if (tag === 'h2') {
      currentHeading = $el.text().replace(/\s+/g, ' ').trim() || undefined;
      return;
    }

    if (tag !== 'ol') return;

    // Top-level numbered paragraphs
    if ($el.hasClass('num1')) {
      const startAttr = $el.attr('start');
      const start = startAttr ? parseInt(startAttr, 10) : 1;
      $el.children('li').each((i, li) => {
        const text = $(li).text().replace(/\s+/g, ' ').trim();
        if (text) {
          paragraphs.push({ number: start + i, text, heading: currentHeading });
        }
      });
      return;
    }

    // Nested sub-list (num2, num3, etc.) — attach to the last paragraph
    const classAttr = $el.attr('class') || '';
    const levelMatch = classAttr.match(/num(\d+)/);
    if (levelMatch) {
      const level = parseInt(levelMatch[1], 10);
      const startAttr = $el.attr('start');
      const start = startAttr ? parseInt(startAttr, 10) : 1;
      const subItems: SubItem[] = [];
      $el.children('li').each((i, li) => {
        const text = $(li).text().replace(/\s+/g, ' ').trim();
        if (text) subItems.push({ number: start + i, text, level });
      });
      const last = paragraphs[paragraphs.length - 1];
      if (last && subItems.length > 0) {
        last.subItems = [...(last.subItems ?? []), ...subItems];
      }
    }
  });

  return paragraphs;
}

/**
 * LEGACY-template paragraph parser (pre-2015 migrated decisions).
 *
 * See the file header for the full structure. In short:
 *   - <p ... listValue="N" listLevel="0"> → top-level paragraph N
 *   - <p ... listValue="N" listLevel="1"+> → sub-item of preceding paragraph
 *   - <span class="list_number_"> inside each → stripped (duplicate of the number)
 *   - <blockquote class="quote"> → appended to the preceding paragraph's text
 *   - h1/h2/h3 → section heading carried onto subsequent paragraphs
 *   - p.disclaimer / p.lastupdate / "**********" separators / empty spacers → skipped
 *
 * Only called when the modern parser finds zero paragraphs, so it cannot
 * affect modern-template pages.
 */
function parseParagraphsLegacy($: CheerioAPI): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  let currentHeading: string | undefined = undefined;

  const body = $('div.body').first();
  if (!body.length) return paragraphs;

  const appendToLast = (text: string): void => {
    const last = paragraphs[paragraphs.length - 1];
    if (last && text) {
      last.text = `${last.text}\n${text}`;
    }
  };

  body.children().each((_, el) => {
    const $el = $(el);
    const tag = el.tagName?.toLowerCase();
    if (!tag) return;

    // Section headings (the legacy template uses h1.Judgment_Heading for
    // "Judgment"; some decisions carry further h2/h3 subheadings).
    if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
      const t = $el.text().replace(/\s+/g, ' ').trim();
      currentHeading = t || undefined;
      return;
    }

    // Quoted passages are siblings of the paragraph they belong to —
    // fold them back into that paragraph so the quote stays retrievable
    // as part of the paragraph a barrister would cite.
    if (tag === 'blockquote') {
      const t = $el.text().replace(/\s+/g, ' ').trim();
      if (t) appendToLast(t);
      return;
    }

    if (tag !== 'p') return;

    const cls = $el.attr('class') || '';
    if (/\bdisclaimer\b/.test(cls) || /\blastupdate\b/.test(cls)) return;

    // The paragraph number lives on the listValue attribute. The HTML
    // parser lowercases attribute names; we check the camelCase form too
    // in case of an XML-mode load.
    const numAttr = $el.attr('listvalue') ?? $el.attr('listValue');
    const levelAttr = $el.attr('listlevel') ?? $el.attr('listLevel');

    if (numAttr === undefined) {
      // Un-numbered <p>: empty spacers, the "**********" end marker, and
      // occasional centred separators. Skip noise; fold any real prose
      // into the preceding paragraph so content is never dropped.
      const t = $el.text().replace(/\s+/g, ' ').trim();
      if (!t || /^[*\s]+$/.test(t)) return;
      appendToLast(t);
      return;
    }

    const number = parseInt(numAttr, 10);
    if (Number.isNaN(number)) return;

    // Strip the visual number span so text doesn't begin "1BASTEN JA".
    const clone = $el.clone();
    clone.find('span.list_number_').remove();
    const text = clone.text().replace(/\s+/g, ' ').trim();
    if (!text) return;

    const listLevel = levelAttr !== undefined ? parseInt(levelAttr, 10) : 0;

    if (!Number.isNaN(listLevel) && listLevel >= 1) {
      // Nested item (e.g. numbered orders inside a paragraph). Attach to
      // the preceding paragraph, mirroring the modern parser's num2+
      // handling. Modern num2 lists carry level=2, so map listLevel=1 → 2.
      const last = paragraphs[paragraphs.length - 1];
      if (last) {
        last.subItems = [
          ...(last.subItems ?? []),
          { number, text, level: listLevel + 1 },
        ];
      }
      return;
    }

    paragraphs.push({ number, text, heading: currentHeading });
  });

  return paragraphs;
}

/**
 * LOTUS-template metadata reader.
 *
 * Lotus pages have no .coversheet — metadata sits in <table> rows:
 *   <td>...spacer img...</td>
 *   <td><b><font>CITATION :</font></b></td>
 *   <td><b><font>Regina v Reid [1999] NSWCCA 258</font></b></td>
 *
 * Labels are matched case-insensitively with the trailing colon and
 * whitespace stripped ("CASES CITED:" and "CITATION :" both normalise
 * cleanly). The value is the FOLLOWING <td> in the same row.
 */
function getLotusField($: CheerioAPI, label: string): string | null {
  const want = label.toUpperCase();
  let result: string | null = null;
  $('div.body td').each((_, el) => {
    if (result !== null) return false;
    const t = $(el).text().replace(/\s+/g, ' ').replace(/\s*:\s*$/, '').trim().toUpperCase();
    if (t !== want) return;
    const valTd = $(el).next('td');
    if (!valTd.length) return;
    const text = valTd.text().replace(/\s+/g, ' ').trim();
    if (text) result = text;
  });
  return result;
}

/** Same as getLotusField but preserves <br>-separated lines as newlines
 *  (needed for CASES CITED / ACTS CITED so the line-splitting citers work). */
function getLotusFieldRaw($: CheerioAPI, label: string): string | null {
  const want = label.toUpperCase();
  let result: string | null = null;
  $('div.body td').each((_, el) => {
    if (result !== null) return false;
    const t = $(el).text().replace(/\s+/g, ' ').replace(/\s*:\s*$/, '').trim().toUpperCase();
    if (t !== want) return;
    const valTd = $(el).next('td');
    if (!valTd.length) return;
    const html = valTd.html() || '';
    const text = html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n');
    if (text) result = text;
  });
  return result;
}

/**
 * LOTUS-template paragraph parser (node-walk).
 *
 * The Lotus body has no structural paragraph markup. Paragraph numbers
 * appear as inline text at the START of an element in the judgment
 * cell's content flow, in two sub-variants:
 *   ~1999 era:  <font>1&nbsp;&nbsp;&nbsp; </font>   (nbsp run after number)
 *   ~2003 era:  <font>1 </font> / <font>4 The appellant was tried ...</font>
 *               (single PLAIN space after number)
 * Because plain "number + space" occurs constantly in prose ("born on
 * 31 May 1986"), a raw text-split is unsafe for the 2003 variant.
 * Instead we walk the content flow node-by-node:
 *
 *   - The judgment lives in one big <td> (the coversheet label/value
 *     cells are tiny). We only treat <td>s whose text exceeds a size
 *     threshold as judgment flow containers.
 *   - For each direct child node of that td, if its text BEGINS with a
 *     1-3 digit number followed by a space or nbsp, AND that number is
 *     sequence-valid (first must be exactly 1; each next must exceed
 *     the last by at most 3), it starts a new paragraph (any remainder
 *     in the same node is the paragraph's opening text).
 *   - Every other node (continuation <font>s, judge-name <b>s, <ul>
 *     quote blocks, Q&A transcripts) is appended to the current
 *     paragraph. Content before paragraph 1 (headnote, formal parts)
 *     is dropped, matching the other templates' body-only behaviour.
 *
 * Prose numbers mid-sentence never begin an element, and the sequence
 * guard rejects stray element-leading numbers, so both sub-variants
 * parse with one mechanism.
 */
function parseParagraphsLotus($: CheerioAPI): Paragraph[] {
  const body = $('div.body').first();
  if (!body.length) return [];

  const paragraphs: Paragraph[] = [];
  // Element text starting with: optional whitespace, 1-3 digits, then at
  // least one space or nbsp, then the remainder (possibly empty).
  const MARKER_RE = /^[\s\u00a0]*(\d{1,3})[ \u00a0]+([\s\S]*)$/;
  // Bare-number marker fonts ("<font>3 </font>") have an empty remainder;
  // they also match /^[\s\u00a0]*(\d{1,3})[ \u00a0]*$/ when the trailing
  // separator was consumed — handle via a second pattern.
  const BARE_RE = /^[\s\u00a0]*(\d{1,3})[ \u00a0]*$/;

  const clean = (s: string): string => s.replace(/[\u00a0\s]+/g, ' ').trim();

  const appendToCurrent = (s: string): void => {
    const t = clean(s);
    if (!t) return;
    const last = paragraphs[paragraphs.length - 1];
    if (!last) return; // content before paragraph 1 (headnote etc.) — drop
    last.text = last.text ? `${last.text} ${t}` : t;
  };

  const nextNumberOk = (num: number): boolean => {
    const last = paragraphs[paragraphs.length - 1];
    if (!last) return num === 1;
    return num > last.number && num <= last.number + 3;
  };

  // Containers we recurse THROUGH (they can wrap several paragraphs):
  const TRANSPARENT = new Set(['p', 'div', 'center', 'span']);
  // Containers treated as one atomic unit (quote blocks, transcripts):
  const ATOMIC = new Set(['ul', 'ol', 'blockquote', 'table']);

  const processNode = (node: any): void => {
    const nodeType = node.type;
    if (nodeType === 'text') {
      appendToCurrent(node.data ?? '');
      return;
    }
    if (nodeType !== 'tag') return;
    const tag = (node.tagName || node.name || '').toLowerCase();
    const $n = $(node);

    if (TRANSPARENT.has(tag)) {
      $n.contents().each((_i, child) => processNode(child));
      return;
    }
    if (ATOMIC.has(tag)) {
      appendToCurrent($n.text());
      return;
    }

    // Leaf-ish elements (font, b, i, u, a, ...): marker check, else append.
    const text = $n.text();
    const m = text.match(MARKER_RE) || text.match(BARE_RE);
    if (m) {
      const num = parseInt(m[1], 10);
      if (nextNumberOk(num)) {
        paragraphs.push({ number: num, text: clean(m[2] ?? '') });
        return;
      }
    }
    appendToCurrent(text);
  };

  // Identify the judgment-flow cell(s). The judgment lives in a large <td>.
  // Older Lotus pages put the whole judgment in one leaf cell; newer ones
  // (e.g. amended appellate decisions) embed inner data/Q&A <table>s inside
  // the judgment cell, so we must NOT reject a cell merely for containing
  // descendant <td>s. Instead we select the MOST SPECIFIC large cell: a
  // cell qualifies if its own text is large AND none of its descendant
  // <td>s is itself large (i.e. it's the innermost big cell on its branch).
  // Inner data tables are absorbed by the ATOMIC handling above.
  const MIN_CELL_CHARS = 800;
  const candidates: any[] = [];
  body.find('td').each((_, td) => {
    const $td = $(td);
    if (clean($td.text()).length < MIN_CELL_CHARS) return;
    // Is any descendant td also large? If so, this is an outer wrapper;
    // skip it and let the inner one be chosen.
    let hasLargeDescendant = false;
    $td.find('td').each((__, inner) => {
      if (clean($(inner).text()).length >= MIN_CELL_CHARS) {
        hasLargeDescendant = true;
        return false;
      }
    });
    if (hasLargeDescendant) return;
    candidates.push(td);
  });

  for (const td of candidates) {
    $(td).contents().each((_i, node) => processNode(node));
  }

  // Strip trailing "**********" end markers from the final paragraph(s).
  for (const p of paragraphs) {
    p.text = p.text.replace(/\s*\*{4,}.*$/, '').trim();
  }
  return paragraphs.filter((p) => p.text.length > 0);
}

function extractSourceIdFromUrl(url: string): string | null {
  const match = url.match(/\/decision\/([a-f0-9]{24})/i);
  return match ? match[1] : null;
}

export function parseNswJudgment(html: string, sourceUrl: string): ParsedJudgment {
  const $ = cheerio.load(html);

  const titleText = $('title').text().replace(/\s+/g, ' ').trim();
  const caseName = titleText.replace(/\s*-\s*NSW Caselaw\s*$/, '').trim() || null;

  const citationRaw =
    getCoversheetField($, 'Medium Neutral Citation:') ?? getLotusField($, 'CITATION');
  const citation = parseCitation(citationRaw);
  const decisionDate = parseDecisionDate(
    getCoversheetField($, 'Decision date:') ?? getLotusField($, 'JUDGMENT DATE'),
  );
  const hearingDates =
    getCoversheetField($, 'Hearing dates:') ?? getLotusField($, 'HEARING DATE(S)');
  const jurisdiction = getCoversheetField($, 'Jurisdiction:');
  const judges = parseJudges(
    getCoversheetField($, 'Before:') ?? getLotusField($, 'JUDGMENT OF'),
  );
  const decisionSummary =
    getCoversheetField($, 'Decision:') ?? getLotusField($, 'DECISION');
  const catchwords =
    getCoversheetFieldRaw($, 'Catchwords:') ?? getLotusFieldRaw($, 'CATCHWORDS');
  const category = getCoversheetField($, 'Category:');
  const casesCited = parseCasesCited(
    getCoversheetFieldRaw($, 'Cases Cited:') ?? getLotusFieldRaw($, 'CASES CITED'),
  );
  const legislationCited = parseLegislationCited(
    getCoversheetFieldRaw($, 'Legislation Cited:') ?? getLotusFieldRaw($, 'ACTS CITED'),
  );
  const parties =
    getCoversheetFieldRaw($, 'Parties:') ?? getLotusFieldRaw($, 'PARTIES');
  const representationModern = getCoversheetFieldRaw($, 'Representation:');
  const lotusCounsel = getLotusFieldRaw($, 'COUNSEL');
  const lotusSolicitors = getLotusFieldRaw($, 'SOLICITORS');
  const representation =
    representationModern ??
    ([
      lotusCounsel ? `Counsel:\n${lotusCounsel}` : null,
      lotusSolicitors ? `Solicitors:\n${lotusSolicitors}` : null,
    ]
      .filter(Boolean)
      .join('\n') || null);

  const fileNumbersRaw =
    getCoversheetField($, 'File Number(s):') ?? getLotusField($, 'FILE NUMBER(S)');
  const fileNumbers = fileNumbersRaw
    ? fileNumbersRaw.split(/[,;]/).map((s) => s.trim()).filter(Boolean)
    : [];

  const publicationRestriction = getCoversheetField($, 'Publication restriction:');
  const suppressionDetected =
    !!publicationRestriction && publicationRestriction.toLowerCase() !== 'nil';

  const court = parseCourt($, citation);

  // Modern template first; mid-era legacy fallback; Lotus text-split last.
  let paragraphs = parseParagraphs($);
  if (paragraphs.length === 0) {
    paragraphs = parseParagraphsLegacy($);
  }
  if (paragraphs.length === 0) {
    paragraphs = parseParagraphsLotus($);
  }

  // Flatten paragraphs (with sub-items) into a citation-ready text blob.
  const fullText = paragraphs
    .map((p) => {
      const head = `[${p.number}] ${p.text}`;
      if (!p.subItems || p.subItems.length === 0) return head;
      const subs = p.subItems.map((s) => `  (${s.number}) ${s.text}`).join('\n');
      return `${head}\n${subs}`;
    })
    .join('\n\n');

  const lastUpdatedText = $('.lastupdate').text().replace(/\s+/g, ' ').trim();
  const lastUpdatedMatch = lastUpdatedText.match(/(\d{1,2}\s+\w+\s+\d{4})/);
  const decisionLastUpdated = lastUpdatedMatch
    ? parseDecisionDate(lastUpdatedMatch[1])
    : null;

  return {
    citation,
    caseName,
    court,
    jurisdiction,
    decisionDate,
    hearingDates,
    judges,
    parties,
    representation,
    fileNumbers,
    category,
    catchwords,
    decisionSummary,
    casesCited,
    legislationCited,
    paragraphs,
    fullText,
    paragraphCount: paragraphs.length,
    publicationRestriction,
    suppressionDetected,
    decisionLastUpdated,
    sourceId: extractSourceIdFromUrl(sourceUrl),
  };
}