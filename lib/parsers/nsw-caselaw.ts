// lib/parsers/nsw-caselaw.ts
/**
 * NSW Caselaw HTML parser.
 *
 * Written against the real HTML structure of NSW Caselaw decision pages.
 * Tested against:
 *   https://www.caselaw.nsw.gov.au/decision/19dffa6432c645fbf145d0ed
 *   (Zacharatos v Western Agricultural Co Pty Ltd (No 2) [2026] NSWSC 474)
 *
 * Page structure observed:
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

function extractSourceIdFromUrl(url: string): string | null {
  const match = url.match(/\/decision\/([a-f0-9]{24})/i);
  return match ? match[1] : null;
}

export function parseNswJudgment(html: string, sourceUrl: string): ParsedJudgment {
  const $ = cheerio.load(html);

  const titleText = $('title').text().replace(/\s+/g, ' ').trim();
  const caseName = titleText.replace(/\s*-\s*NSW Caselaw\s*$/, '').trim() || null;

  const citationRaw = getCoversheetField($, 'Medium Neutral Citation:');
  const citation = parseCitation(citationRaw);
  const decisionDate = parseDecisionDate(getCoversheetField($, 'Decision date:'));
  const hearingDates = getCoversheetField($, 'Hearing dates:');
  const jurisdiction = getCoversheetField($, 'Jurisdiction:');
  const judges = parseJudges(getCoversheetField($, 'Before:'));
  const decisionSummary = getCoversheetField($, 'Decision:');
  const catchwords = getCoversheetFieldRaw($, 'Catchwords:');
  const category = getCoversheetField($, 'Category:');
  const casesCited = parseCasesCited(getCoversheetFieldRaw($, 'Cases Cited:'));
  const legislationCited = parseLegislationCited(getCoversheetFieldRaw($, 'Legislation Cited:'));
  const parties = getCoversheetFieldRaw($, 'Parties:');
  const representation = getCoversheetFieldRaw($, 'Representation:');

  const fileNumbersRaw = getCoversheetField($, 'File Number(s):');
  const fileNumbers = fileNumbersRaw
    ? fileNumbersRaw.split(/[,;]/).map((s) => s.trim()).filter(Boolean)
    : [];

  const publicationRestriction = getCoversheetField($, 'Publication restriction:');
  const suppressionDetected =
    !!publicationRestriction && publicationRestriction.toLowerCase() !== 'nil';

  const court = parseCourt($, citation);

  const paragraphs = parseParagraphs($);

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