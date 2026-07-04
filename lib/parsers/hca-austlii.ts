// lib/parsers/hca-austlii.ts
/**
 * AustLII High Court of Australia judgment parser.
 *
 * Written against the REAL HTML structure of AustLII HCA decision pages,
 * verified against:
 *   https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/2024/1.html
 *   (Harvey v Minister for Primary Industry and Resources [2024] HCA 1)
 *
 * Outputs the SAME ParsedJudgment shape as lib/parsers/nsw-caselaw.ts so it
 * drops into the existing judgments table + embedding pipeline unchanged.
 *
 * =============================================================================
 * OBSERVED STRUCTURE
 * =============================================================================
 *
 * Everything lives in <article class="the-document">.
 *
 * COVERSHEET (a run of <br>-separated text with <b>/<i> labels, NOT a table):
 *   <h1>Case name [2024] HCA 1 (7 February 2024)</h1>
 *   <p>Last Updated: ...</p>
 *   <p align="center"><b>HIGH COURT OF AUSTRALIA</b> ... GAGELER CJ, GORDON ... JJ</p>
 *   <p> ... PARTIES (APPELLANTS / AND / RESPONDENTS) ... </p>
 *   <p align="center"><i>Case name</i> [2024] HCA 1
 *       Date of Hearing: ... Date of Judgment: ... FileNo ORDER</p>
 *   <ol><li value="1"><i>Appeal allowed.</i></li></ol>      <-- the ORDERS
 *   ...
 *   <p> ... On appeal from ... Representation ... counsel/solicitors ... </p>
 *   <p>Notice: This copy ...</p>
 *   <p><b>CATCHWORDS</b> ... catchwords text ...</p>
 *
 * REASONS (the judgment body):
 *   <p ...>GAGELER CJ, GORDON, STEWARD AND GLEESON JJ.</p>   <-- opinion heading
 *   <ol><li value="1"> paragraph 1 text </li></ol>
 *   <ol><li value="2"> paragraph 2 text </li></ol>
 *   <blockquote> (a) quoted material </blockquote>            <-- fold into prev
 *   <ol><li value="3"> paragraph 3 text </li></ol>
 *   ...
 *   <hr>
 *   <p><b><a name="fn1">[1]</a></b> footnote text</p>         <-- footnotes
 *
 * KEY FACTS THE PARSER RELIES ON:
 *   - Judgment paragraphs are <li value="N"> inside <ol>. The `value`
 *     attribute is the authoritative paragraph number (no text scraping).
 *   - <ol> blocks are FRAGMENTED: the main sequence 1..120 is split across
 *     many <ol> elements because quotes/sub-lists interrupt it. Some <ol>
 *     blocks are sub-enumerations that RESTART at a low number (e.g. a
 *     quoted list of (a)(b)(c) rendered as value 1..3). We distinguish main
 *     paragraphs from sub-items with a MONOTONIC SEQUENCE CHECK: a real
 *     judgment paragraph's value == lastMainValue + 1; a value that jumps
 *     backwards or isn't the next-in-sequence is a sub-item, which we FOLD
 *     into the current paragraph's text.
 *   - <blockquote> siblings are quoted passages belonging to the preceding
 *     paragraph; we fold their text in too.
 *   - Inline footnote refs <sup><a name="fnBN">[N]</a></sup> are STRIPPED
 *     from paragraph text (design decision: cleaner for retrieval).
 *   - Cited cases/legislation are auto-tagged by AustLII with
 *     class="autolink_findcases" / class="autolink_findacts"; we harvest
 *     these from the whole document for casesCited / legislationCited.
 *
 * The ORDERS coversheet <ol> (near the top, before reasons) must NOT be
 * mistaken for judgment paragraph 1. We only start collecting judgment
 * paragraphs AFTER the coversheet — detected by the CATCHWORDS marker (the
 * last coversheet element) or, failing that, the first opinion heading.
 */

import * as cheerio from 'cheerio';
import type { CheerioAPI, Cheerio } from 'cheerio';
import type { AnyNode } from 'domhandler';

// -----------------------------------------------------------------------------
// Shared output types — MUST match lib/parsers/nsw-caselaw.ts
// -----------------------------------------------------------------------------

export interface SubItem {
  number: number;
  text: string;
  level: number;
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

// -----------------------------------------------------------------------------
// Small utilities
// -----------------------------------------------------------------------------

const clean = (s: string): string =>
  s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** "7 February 2024" -> "2024-02-07"; bad input -> null. */
function parseDateToISO(input: string | null): string | null {
  if (!input) return null;
  const m = clean(input).match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** Extract 'hca-YYYY-N' style id from an AustLII HCA url. */
function extractSourceIdFromUrl(url: string): string | null {
  const m = url.match(/\/cases\/cth\/HCA\/(\d{4})\/(\d+)\.html/i);
  return m ? `hca-${m[1]}-${m[2]}` : null;
}

// -----------------------------------------------------------------------------
// Coversheet extraction
//
// The coversheet isn't a table — it's <br>-delimited text. We work from the
// document's overall text with a few anchored regexes, which is more robust
// than trying to walk the <br> soup element by element.
// -----------------------------------------------------------------------------

interface Coversheet {
  citation: string | null;
  caseName: string | null;
  judges: string[];
  parties: string | null;
  hearingDates: string | null;
  decisionDate: string | null;
  representation: string | null;
  catchwords: string | null;
  fileNumbers: string[];
  decisionSummary: string | null; // the ORDER text
}

function extractCoversheet($: CheerioAPI, docText: string): Coversheet {
  // Title / citation / caseName come from <h1> (most reliable).
  const h1 = clean($('article.the-document h1').first().text());
  let citation: string | null = null;
  let caseName: string | null = null;
  const citMatch = h1.match(/\[(\d{4})\]\s+HCA\s+(\d+)/);
  if (citMatch) {
    citation = citMatch[0];
    caseName = h1.slice(0, citMatch.index).trim() || null;
  } else {
    caseName = h1 || null;
  }

  // Judges: the coram line follows "HIGH COURT OF AUSTRALIA". Capture the
  // run of uppercase judge names up to the parties block. e.g.
  // "GAGELER CJ, GORDON, EDELMAN, STEWARD AND GLEESON JJ".
  let judges: string[] = [];
  // Coram sits right after "HIGH COURT OF AUSTRALIA", ending in "JJ"/"J",
  // before the parties block.
  const coramMatch = docText.match(
    /HIGH COURT OF AUSTRALIA\s+([A-Z][A-Za-z',. -]*?\b(?:CJ|JJ|J)\b)\s+[A-Z]/,
  );
  if (coramMatch) {
    judges = parseJudges(coramMatch[1]);
  }

  // Parties: between the coram and the "<caseName>" restatement. Grab the
  // APPELLANT/RESPONDENT block.
  let parties: string | null = null;
  const partiesMatch = docText.match(
    /\b(?:CJ|JJ|J)\s+([A-Z][A-Za-z'&. ]+?(?:APPELLANTS?|APPLICANTS?|PLAINTIFFS?|PROSECUTORS?)\s+AND\s+[\s\S]{0,700}?(?:RESPONDENTS?|DEFENDANTS?))/,
  );
  if (partiesMatch) {
    parties = clean(partiesMatch[1]);
  }

  // Hearing / judgment dates.
  const hearingDates =
    parseDateToISO(
      (docText.match(/Date of Hearing:\s*([^\n<]+?\d{4})/) || [])[1] ?? null,
    ) ?? null;
  const decisionDate =
    parseDateToISO(
      (docText.match(/Date of Judgment:\s*([^\n<]+?\d{4})/) || [])[1] ?? null,
    ) ?? null;

  // File numbers: e.g. "D9/2022" or "S123/2023, S124/2023".
  const fileNumbers: string[] = [];
  const fnMatch = docText.match(
    /Date of Judgment:\s*\d{1,2}\s+[A-Za-z]+\s+\d{4}\s+([A-Z]?\d+\/\d{4}(?:\s*,\s*[A-Z]?\d+\/\d{4})*)\s+ORDER/,
  );
  if (fnMatch) {
    for (const fn of fnMatch[1].split(/[,;]/)) {
      const t = clean(fn);
      if (t) fileNumbers.push(t);
    }
  }

  // Representation: the block after "Representation".
  let representation: string | null = null;
  const repMatch = docText.match(
    /\bRepresentation\s+([\s\S]{5,1500}?)(?:\s+Notice:|\s+CATCHWORDS)/,
  );
  if (repMatch) {
    const r = clean(repMatch[1]);
    if (r.length > 5) representation = r;
  }

  // Catchwords: block after "CATCHWORDS" up to the coram restatement / reasons.
  let catchwords: string | null = null;
  const cwMatch = docText.match(/CATCHWORDS\s+([\s\S]+)/);
  if (cwMatch) {
    let c = clean(cwMatch[1]);
    if (caseName && c.startsWith(caseName)) {
      c = c.slice(caseName.length).trim();
    }
    const reasonsCut = c.search(/[A-Z][A-Z',. -]*\b(?:CJ|JJ|J)\b\.\s+[A-Z][a-z]/);
    if (reasonsCut > 40) {
      c = c.slice(0, reasonsCut).trim();
    }
    if (c.length > 10) catchwords = c;
  }

  // Decision summary = the ORDER text, between the "ORDER" label and the
  // "On appeal from"/"Representation" boundary. Extracted from the flattened
  // docText (the orders <ol> are nested inside <p>, so a DOM-child walk misses
  // them; the flattened text is reliable).
  let decisionSummary: string | null = null;
  const orderMatch = docText.match(/\bORDER\s+([\s\S]+?)(?:\s+On appeal from|\s+Representation|\s+Notice:)/);
  if (orderMatch) {
    const o = clean(orderMatch[1]);
    if (o.length > 5) decisionSummary = o;
  }

  return {
    citation,
    caseName,
    judges,
    parties,
    hearingDates,
    decisionDate,
    representation,
    catchwords,
    fileNumbers,
    decisionSummary,
  };
}

/**
 * Parse a coram string like "GAGELER CJ, GORDON, EDELMAN, STEWARD AND
 * GLEESON JJ" into ["GAGELER CJ", "GORDON J", "EDELMAN J", "STEWARD J",
 * "GLEESON J"]. The trailing "JJ" applies J to the bare names.
 */
function parseJudges(raw: string): string[] {
  const s = clean(raw).replace(/\bAND\b/gi, ',');
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return [];

  // Determine the default suffix from the last token (JJ -> J, CJ stays).
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    let p = parts[i];
    // Normalise a trailing "JJ" on the last element to "J".
    p = p.replace(/\bJJ\b\.?$/,'J');
    // If a bare surname (no J/CJ), append J.
    if (!/\b(?:CJ|J)\b/.test(p)) {
      p = `${p} J`;
    }
    out.push(clean(p));
  }
  return out;
}

/**
 * Reconstruct the ORDER text from the coversheet. The orders are the FIRST
 * run of <ol><li value="N"> blocks (and interleaved <blockquote> sub-orders)
 * that appear BEFORE the reasons. We collect them until we hit the
 * "On appeal from" / "Representation" / "Notice:" boundary.
 */
function extractOrders($: CheerioAPI): string | null {
  const article = $('article.the-document').first();
  if (!article.length) return null;

  const lines: string[] = [];
  let started = false;
  let stopped = false;

  article.children().each((_i, el) => {
    if (stopped) return;
    const $el = $(el);
    const tag = (el as { tagName?: string }).tagName?.toLowerCase();
    const text = clean($el.text());

    if (!started) {
      // Orders begin right after a paragraph containing "ORDER".
      if (/\bORDER\b/.test(text) && text.length < 400) {
        started = true;
      }
      return;
    }

    // Stop when we reach the post-orders coversheet prose.
    if (/On appeal from|Representation|Notice:/.test(text)) {
      stopped = true;
      return;
    }

    if (tag === 'ol') {
      $el.find('li').each((__, li) => {
        const v = $(li).attr('value');
        const t = clean($(li).text());
        if (t) lines.push(v ? `${v}. ${t}` : t);
      });
    } else if (tag === 'blockquote') {
      const t = clean($el.text());
      if (t) lines.push(`   ${t}`);
    }
  });

  const joined = lines.join('\n').trim();
  return joined.length > 0 ? joined : null;
}

// -----------------------------------------------------------------------------
// Reasons (paragraph) extraction
// -----------------------------------------------------------------------------

/**
 * Walk the document collecting judgment paragraphs from <ol><li value="N">.
 *
 * We only begin collecting AFTER the coversheet. The coversheet ends at
 * CATCHWORDS; the reasons begin at the first opinion heading (caps judges)
 * or the first <li value="1"> that appears after CATCHWORDS.
 *
 * Main-paragraph vs sub-item disambiguation:
 *   Maintain `lastMain`. A <li value="N"> is a MAIN paragraph iff
 *   N === lastMain + 1 (the next number in the running judgment sequence).
 *   Any other <li> (a restart to a low number, or a jump) is a SUB-ITEM of
 *   the current paragraph and is FOLDED into its text. <blockquote> siblings
 *   are folded into the current paragraph too.
 */
function extractParagraphs(
  $: CheerioAPI,
  reasonsStartOffset: number,
  fullHtml: string,
): Paragraph[] {
  const article = $('article.the-document').first();
  if (!article.length) return [];

  const paragraphs: Paragraph[] = [];
  let lastMain = 0;
  let inReasons = false;

  const foldIntoCurrent = (text: string): void => {
    const t = clean(stripFootnoteRefs(text));
    if (!t) return;
    const last = paragraphs[paragraphs.length - 1];
    if (!last) return;
    last.text = last.text ? `${last.text} ${t}` : t;
  };

  // Detect the reasons boundary by walking children and tracking whether we've
  // passed CATCHWORDS. Once past, an opinion-heading <p> (caps judges ending
  // J/JJ/CJ) or the first main <li value="1"> switches inReasons on.
  const children = article.children().toArray();

  for (let i = 0; i < children.length; i++) {
    const el = children[i];
    const $el = $(el);
    const tag = (el as { tagName?: string }).tagName?.toLowerCase();
    const text = clean($el.text());

    if (!inReasons) {
      // We consider reasons started once we've seen CATCHWORDS earlier AND we
      // hit either an opinion heading or a value="1" li.
      const passedCatchwords =
        fullHtml.indexOf('CATCHWORDS') !== -1 &&
        ($el.text() &&
          fullHtml.indexOf($.html($el) ?? '') > fullHtml.indexOf('CATCHWORDS'));

      const isOpinionHeading =
        tag === 'p' &&
        /^[A-Z][A-Z',. -]*\b(?:CJ|JJ|J)\b\.?$/.test(text) &&
        text.length < 120;

      const hasValue1 =
        tag === 'ol' && $el.find('li[value="1"]').length > 0;

      if ((passedCatchwords && (isOpinionHeading || hasValue1)) ) {
        inReasons = true;
        // If this element itself is an opinion heading, attach as heading to
        // the next paragraph via a pending mechanism.
        if (isOpinionHeading) {
          pendingHeading = text;
          continue;
        }
      } else {
        continue;
      }
    }

    // ---- We're in the reasons. ----

    if (tag === 'p') {
      // An opinion heading between paragraphs (e.g. a dissent starting).
      if (/^[A-Z][A-Z',. -]*\b(?:CJ|JJ|J)\b\.?$/.test(text) && text.length < 120) {
        pendingHeading = text;
        continue;
      }
      // Stray prose <p> between <ol> blocks — fold into current paragraph.
      if (text) foldIntoCurrent(text);
      continue;
    }

    if (tag === 'blockquote') {
      if (text) foldIntoCurrent(text);
      continue;
    }

    if (tag === 'ol') {
      $el.find('> li').each((__, li) => {
        const $li = $(li);
        const vAttr = $li.attr('value');
        const v = vAttr ? parseInt(vAttr, 10) : NaN;
        const liText = clean(stripFootnoteRefs($li.text()));

        if (Number.isFinite(v) && v === lastMain + 1) {
          // New main judgment paragraph.
          const p: Paragraph = { number: v, text: liText };
          if (pendingHeading) {
            p.heading = pendingHeading;
            pendingHeading = null;
          }
          paragraphs.push(p);
          lastMain = v;
        } else {
          // Sub-item / restart — fold into current paragraph.
          foldIntoCurrent(liText);
        }
      });
      continue;
    }

    if (tag === 'hr') {
      // Footnotes follow the <hr>; stop collecting reasons.
      break;
    }
  }

  return paragraphs;
}

// Module-level pending heading (opinion heading captured just before the
// paragraph it introduces). Reset per parse via parseHcaJudgment.
let pendingHeading: string | null = null;

/** Remove inline footnote reference superscripts like [1], [2] from text. */
function stripFootnoteRefs(text: string): string {
  // Footnote refs render as bracketed numbers, often after being flattened
  // from <sup><a>[1]</a></sup>. Remove standalone [N] tokens.
  return text.replace(/\[\d{1,3}\]/g, '');
}

// -----------------------------------------------------------------------------
// OLD-TEMPLATE fallback (pre-~2008): anchor-numbered paragraphs
//
// Older AustLII HCA pages have no <li value="N"> markup. Instead every
// paragraph is preceded by an anchor: <a name="paraN"></a>. Verified against
// Nicholls v The Queen [2005] HCA 1 (377 paragraphs, clean 1..377 sequence).
// Strategy: split the raw HTML on the paraN anchors and take the text between
// anchor N and anchor N+1 (bounded at the footnote <hr> / end of article).
// -----------------------------------------------------------------------------

function extractParagraphsAnchors(html: string): Paragraph[] {
  const anchorRe = /<a\s+name="para(\d+)"/gi;
  const marks: Array<{ num: number; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    marks.push({ num: parseInt(m[1], 10), index: m.index });
  }
  if (marks.length === 0) return [];

  // End bound: footnote rule <hr> after the last anchor, else </article>,
  // else end of document.
  const afterLast = html.slice(marks[marks.length - 1].index);
  const hrOffset = afterLast.search(/<hr[\s>]/i);
  const artOffset = afterLast.search(/<\/article>/i);
  let endIndex = html.length;
  if (hrOffset > -1) endIndex = marks[marks.length - 1].index + hrOffset;
  else if (artOffset > -1) endIndex = marks[marks.length - 1].index + artOffset;

  const paragraphs: Paragraph[] = [];
  let lastMain = 0;
  for (let i = 0; i < marks.length; i++) {
    const { num, index } = marks[i];
    const segEnd = i + 1 < marks.length ? marks[i + 1].index : endIndex;
    const segHtml = html.slice(index, segEnd);
    const text = clean(
      stripFootnoteRefs(
        segHtml
          .replace(/<br\s*\/?>/gi, ' ')
          .replace(/<[^>]+>/g, ' '),
      ),
    );
    if (!text) continue;
    if (num === lastMain + 1) {
      paragraphs.push({ number: num, text });
      lastMain = num;
    } else {
      // Out-of-sequence anchor — fold into previous (defensive; verified
      // sample had a perfectly clean sequence).
      const last = paragraphs[paragraphs.length - 1];
      if (last) last.text = `${last.text} ${text}`;
    }
  }
  return paragraphs;
}

// -----------------------------------------------------------------------------
// Cited cases / legislation via AustLII autolink classes
// -----------------------------------------------------------------------------

function extractCitedCases($: CheerioAPI, ownCitation: string | null): CitedCase[] {
  const seen = new Set<string>();
  const out: CitedCase[] = [];
  $('a.autolink_findcases').each((_i, a) => {
    const raw = clean($(a).text());
    // Only accept links whose text contains a real neutral/reported citation
    // (has a court token). This excludes bare paragraph refs like "[287]".
    const citMatch = raw.match(/\[(\d{4})\]\s+[A-Z]{2,8}\s+\d+|\(\d{4}\)\s+\d+\s+[A-Z]{1,6}\s+\d+/);
    if (!citMatch) return;
    const citation = citMatch[0].replace(/\.$/, '');
    if (seen.has(citation)) return;
    if (ownCitation && citation === ownCitation) return; // skip self-reference
    seen.add(citation);
    let name = '';
    const prev = $(a).prev('i');
    if (prev.length) name = clean(prev.text());
    out.push({ name: name || citation, citation, raw });
  });
  return out;
}

function extractCitedLegislation($: CheerioAPI): CitedLegislation[] {
  const seen = new Set<string>();
  const out: CitedLegislation[] = [];
  $('a.autolink_findacts').each((_i, a) => {
    const raw = clean($(a).text());
    // Act links are the Act title (e.g. "Native Title Act 1993"); section
    // links are like "s 24MD(6B)". Keep Act-title entries as the canonical
    // legislation list.
    if (/^s\s|^ss\s|section/i.test(raw)) return; // skip bare section refs
    const title = raw;
    if (!title || seen.has(title)) return;
    seen.add(title);
    out.push({ title, raw });
  });
  return out;
}

// -----------------------------------------------------------------------------
// Main entry point
// -----------------------------------------------------------------------------

export function parseHcaJudgment(html: string, sourceUrl: string): ParsedJudgment {
  pendingHeading = null; // reset module state per parse
  const $ = cheerio.load(html);

  // A flattened text view of the document for the coversheet regexes.
  // IMPORTANT: cheerio's .text() drops <br> tags entirely, running adjacent
  // tokens together ("HIGH COURT OF AUSTRALIAGAGELER CJ"). The HCA coversheet
  // is <br>-delimited, so we must convert <br> (and block tags) to spaces
  // BEFORE flattening, or the coversheet regexes can't find field boundaries.
  const article = $('article.the-document');
  const articleHtmlForText = (article.html() ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|ol|blockquote|h[1-6])>/gi, ' </$1> ');
  const docText = clean(cheerio.load(articleHtmlForText).root().text());

  const cover = extractCoversheet($, docText);
  // Modern template first (<li value="N">); anchor-based fallback for
  // pre-~2008 pages (<a name="paraN">). Mirrors the NSW parser's dispatch.
  let paragraphs = extractParagraphs($, 0, html);
  if (paragraphs.length === 0) {
    paragraphs = extractParagraphsAnchors(html);
  }

  const casesCited = extractCitedCases($, cover.citation);
  const legislationCited = extractCitedLegislation($);

  // fullText: same flattened form as the NSW parser.
  const fullText = paragraphs
    .map((p) => {
      const head = p.heading ? `${p.heading}\n[${p.number}] ${p.text}` : `[${p.number}] ${p.text}`;
      return head;
    })
    .join('\n\n');

  // "Last Updated: 14 February 2024"
  const lastUpdatedMatch = docText.match(/Last Updated:\s*(\d{1,2}\s+[A-Za-z]+\s+\d{4})/);
  const decisionLastUpdated = lastUpdatedMatch
    ? parseDateToISO(lastUpdatedMatch[1])
    : null;

  return {
    citation: cover.citation,
    caseName: cover.caseName,
    court: 'High Court of Australia',
    jurisdiction: 'Commonwealth',
    decisionDate: cover.decisionDate,
    hearingDates: cover.hearingDates,
    judges: cover.judges,
    parties: cover.parties,
    representation: cover.representation,
    fileNumbers: cover.fileNumbers,
    category: null, // HCA pages have no category field
    catchwords: cover.catchwords,
    decisionSummary: cover.decisionSummary,
    casesCited,
    legislationCited,
    paragraphs,
    fullText,
    paragraphCount: paragraphs.length,
    publicationRestriction: null,
    suppressionDetected: false,
    decisionLastUpdated,
    sourceId: extractSourceIdFromUrl(sourceUrl),
  };
}