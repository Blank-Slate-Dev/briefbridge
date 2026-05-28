// lib/legislation/parser-nsw.ts
//
// XML → hierarchical section tree parser for legislation.nsw.gov.au content.
//
// Counterpart to lib/legislation/parser.ts (which parses Commonwealth
// legislation.gov.au HTML). This parses the NSW Parliamentary Counsel
// "LDDS Exchange XML" format. The output is the SAME ParsedSection[] /
// ParseResult shape the Cth parser produces, so scripts/ingest-nsw-
// legislation.ts can reuse the identical two-pass insert flow.
//
// =============================================================================
// WHY XML (NOT HTML) FOR NSW
// =============================================================================
//
// NSW publishes an authoritative XML exchange format from which its HTML
// is rendered. It is dramatically cleaner than the Cth HTML we parse:
//
//   - Title / year / number are ATTRIBUTES on the root <exdoc> element.
//     No text extraction → none of the citation-truncation risk that the
//     Cth ingest pipeline suffered (where the short title was parsed from
//     rendered text and could be mangled).
//   - Hierarchy is EXPLICITLY NESTED via <level> elements. We derive
//     parent/child from the XML tree directly — no stack inference from
//     CSS class sequences (the source of the Cth schedule/Dictionary edge
//     cases).
//   - Amendment history is cleanly isolated in <content type="historynote">
//     subtrees. We skip them with one filter instead of stripping
//     scattered inline notes.
//
// =============================================================================
// STRUCTURE MAP (validated against Civil Liability Act 2002 No 22)
// =============================================================================
//
// Root:        <exdoc id="act-2002-022" title="..." year="2002" number="22"
//                     first.valid.date="2022-06-16">
//
// Content is split into <content type="..."> blocks:
//   body        → operative provisions          ← WALK
//   schedules   → schedules                      ← WALK
//   front       → long title                     ← read long title, no rows
//   coverdata   → status record                  ← SKIP
//   historynote → amendment history (228×)       ← SKIP
//   editorial / historicalnotes                  ← SKIP
//   auto-inserted → TRANSPARENT WRAPPER          ← RECURSE THROUGH (see below)
//
// Structural hierarchy nodes (each becomes a legislation_sections row):
//   <level type="chapter">     → 'chapter'
//   <level type="part">        → 'part'      (or 'schedule_part' in a schedule)
//   <level type="division">    → 'division'
//   <level type="subdivision"> → 'subdivision'
//   <level type="clause">      → 'section'   (or 'schedule_clause' in a schedule)
//   <level type="schedule">    → 'schedule'
//   <level type="tableamends"|"tableleg"|"historicalnotes"> → SKIP (amendment tables)
//
// Below 'section' we DO NOT emit rows — we flatten into the section's text,
// matching the Cth parser (which inlines <p class="subsection">) and the
// embedder (which only embeds level IN ('section','schedule_clause')):
//   <tier type="subclause">  → "(1) ..." line(s)
//   <list>/<li>              → "(a) ..." paragraph lines
//   <deflist>/<defterm>      → definition lines (term + body)
//   <table> (CALS)           → flattened "cell | cell" rows
//   <note type="legtext">    → "Note. ..." appended to the section
//
// =============================================================================
// THE auto-inserted LANDMINE (two forms — both validated)
// =============================================================================
//
// NSW wraps content inserted by later amendments in auto-inserted wrappers.
// These are TRANSPARENT — we must recurse through them, NOT skip them, or we
// lose real provisions. There are TWO forms:
//
//   1. <content type="auto-inserted"> wraps whole Parts/Divisions/sections.
//      e.g. the ENTIRE Part 1A "Negligence" (ss 5A–5T, the core negligence
//      provisions) lives inside one of these because Part 1A was inserted by
//      the 2002 amendment. Skipping it would delete the most important Part
//      of the Act.
//
//   2. <pre type="auto-inserted"> wraps a single re-inserted <tier subclause>
//      INSIDE a section. e.g. s 16(1) is wrapped this way. A naive <pre>
//      handler that only reads direct <block> children drops the subclause.
//
// Both are handled by recursing through ALL children of the wrapper.
//
// =============================================================================
// REPEALED PROVISIONS
// =============================================================================
//
// <repealed><repealedtxt></repealedtxt></repealed> is empty. Repealed section
// ranges (e.g. "6–8", "9, 10") still emit a row (for citation resolution /
// navigation) but with empty text. The embedder's `text != ''` filter skips
// them from semantic search automatically. We must not crash on empty.
//
// =============================================================================

import * as cheerio from 'cheerio';
import type {
  LegislationSectionLevel,
  LegislationJurisdiction,
} from '@/lib/db/schema';
import type { ParsedSection, ParseResult } from './parser';
import {
  buildActCitation,
  buildSectionCitation,
  buildBreadcrumb,
  buildPath,
  type CitationSegment,
} from './citations';

// =============================================================================
// Result types
// =============================================================================

/**
 * Act-level metadata read directly from the <exdoc> root attributes.
 * Unlike the Cth ingester (where the caller supplies the short title),
 * the NSW ingester reads all of this straight from the authoritative XML.
 */
export interface NswActMeta {
  registrationId: string; // <exdoc id="...">  e.g. 'act-2002-022'
  shortTitle: string; // <exdoc title="...">  e.g. 'Civil Liability Act 2002'
  longTitle: string | null; // <content type="front"> long title
  year: number | null; // <exdoc year="...">
  number: number | null; // <exdoc number="..."> (the "No 22")
  jurisdiction: Extract<LegislationJurisdiction, 'nsw'>;
}

/**
 * Same as the Cth ParseResult, plus the act metadata the ingester needs.
 * `sections` is the identical ParsedSection[] shape, so the ingester's
 * two-pass insert (insert rows, then link parentSectionId via parentIndex)
 * works unchanged.
 */
export interface NswParseResult extends ParseResult {
  meta: NswActMeta;
}

// =============================================================================
// Public entry point
// =============================================================================

export function parseNswLegislationXml(xml: string): NswParseResult {
  // xmlMode preserves the NSW tag vocabulary and mixed content ordering.
  const $ = cheerio.load(xml, { xmlMode: true });
  const parser = new NswParser($);
  return parser.run();
}

// =============================================================================
// Parser
// =============================================================================

const SKIP_CONTENT_TYPES = new Set([
  'historynote',
  'coverdata',
  'editorial',
  'historicalnotes',
]);

const SKIP_LEVEL_TYPES = new Set(['tableamends', 'tableleg', 'historicalnotes']);

class NswParser {
  private readonly $: cheerio.CheerioAPI;
  private readonly sections: ParsedSection[] = [];
  private readonly warnings: string[] = [];
  private nextSortOrder = 0;
  private actCitation = '';

  constructor($: cheerio.CheerioAPI) {
    this.$ = $;
  }

  run(): NswParseResult {
    const $ = this.$;
    const exdoc = $('exdoc').first();
    if (exdoc.length === 0) {
      throw new Error(
        'parseNswLegislationXml: no <exdoc> root element found — not a NSW LDDS exchange XML document.',
      );
    }

    const shortTitle = (exdoc.attr('title') || '').trim();
    const yearAttr = exdoc.attr('year');
    const numberAttr = exdoc.attr('number');
    const registrationId = (exdoc.attr('id') || '').trim();
    const compilationDate = (exdoc.attr('first.valid.date') || '').trim() || null;

    this.actCitation = buildActCitation(shortTitle, 'nsw');

    // Long title from <content type="front">.
    let longTitle: string | null = null;
    exdoc.children('content').each((_, c) => {
      if (this.$(c).attr('type') === 'front') {
        const t = this.collapse(this.$(c).find('txt').first().text());
        if (t) longTitle = t;
        return false; // stop
      }
    });

    // Walk each top-level <content> block.
    exdoc.children('content').each((_, c) => {
      this.walkStructure(c, [], false);
    });

    const meta: NswActMeta = {
      registrationId,
      shortTitle,
      longTitle,
      year: yearAttr ? parseInt(yearAttr, 10) : null,
      number: numberAttr ? parseInt(numberAttr, 10) : null,
      jurisdiction: 'nsw',
    };

    return {
      sections: this.sections,
      compilationDate,
      compilationNumber: null, // NSW has no Cth-style compilation number
      warnings: this.warnings,
      meta,
    };
  }

  // ---------------------------------------------------------------------------
  // Structural walk — emits one row per chapter/part/division/subdivision/
  // section/schedule/schedule_part/schedule_clause.
  // ---------------------------------------------------------------------------

  private walkStructure(
    node: any,
    stack: number[],
    insideSchedule: boolean,
  ): void {
    const tag = this.tagOf(node);
    if (tag === undefined) return; // text node
    const $n = this.$(node);
    const type = $n.attr('type');

    if (tag === 'content') {
      if (type && SKIP_CONTENT_TYPES.has(type)) return;
      // body / schedules / front / auto-inserted → recurse transparently.
      this.recurseChildren($n, stack, insideSchedule);
      return;
    }

    if (tag === 'level') {
      if (type && SKIP_LEVEL_TYPES.has(type)) return;

      if (type === 'chapter') {
        const { number, heading } = this.headParts($n, 'Chapter');
        const idx = this.emit('chapter', number, heading, stack);
        this.recurseChildren($n, [...stack, idx], insideSchedule);
        return;
      }
      if (type === 'part') {
        const { number, heading } = this.headParts($n, 'Part');
        const idx = this.emit(
          insideSchedule ? 'schedule_part' : 'part',
          number,
          heading,
          stack,
        );
        this.recurseChildren($n, [...stack, idx], insideSchedule);
        return;
      }
      if (type === 'division') {
        const { number, heading } = this.headParts($n, 'Division');
        const idx = this.emit('division', number, heading, stack);
        this.recurseChildren($n, [...stack, idx], insideSchedule);
        return;
      }
      if (type === 'subdivision') {
        const { number, heading } = this.headParts($n, 'Subdivision');
        const idx = this.emit('subdivision', number, heading, stack);
        this.recurseChildren($n, [...stack, idx], insideSchedule);
        return;
      }
      if (type === 'clause') {
        const { number, heading } = this.headParts($n, null);
        const idx = this.emit(
          insideSchedule ? 'schedule_clause' : 'section',
          number,
          heading,
          stack,
        );
        this.sections[idx].text = this.clauseText($n);
        return; // a clause is a structural leaf — its content is its text
      }
      if (type === 'schedule') {
        const { number, heading } = this.headParts($n, 'Schedule');
        const idx = this.emit('schedule', number, heading, []);
        this.recurseChildren($n, [idx], true);
        return;
      }

      // Unknown level type — warn (so new structures on other Acts surface
      // loudly) but recurse so content isn't lost.
      this.warnings.push(
        `Unknown <level type="${type ?? ''}"> — recursed transparently. Review for this Act.`,
      );
      this.recurseChildren($n, stack, insideSchedule);
      return;
    }

    // <tier> at structural position (longtitle/statusrecord/penalty) is not a
    // row. subclause tiers live inside clauses and are handled by clauseText.
    if (tag === 'tier') return;

    // Any other element (e.g. metadata, parentattributes already filtered) —
    // recurse defensively.
    this.recurseChildren($n, stack, insideSchedule);
  }

  private recurseChildren(
    $n: cheerio.Cheerio<any>,
    stack: number[],
    insideSchedule: boolean,
  ): void {
    $n.contents().each((_, c) => {
      if ((c as any).type === 'text') return;
      const tag = this.tagOf(c);
      if (tag === 'head' || tag === 'parentattributes') return;
      this.walkStructure(c, stack, insideSchedule);
    });
  }

  // ---------------------------------------------------------------------------
  // Row emission
  // ---------------------------------------------------------------------------

  private emit(
    level: LegislationSectionLevel,
    number: string,
    heading: string | null,
    stack: number[],
  ): number {
    const parentIndex = stack.length ? stack[stack.length - 1] : -1;
    const ancestorSegments: CitationSegment[] = stack.map((i) => ({
      level: this.sections[i].level,
      number: this.sections[i].number,
    }));
    const segments: CitationSegment[] = [...ancestorSegments, { level, number }];

    const idx = this.sections.length;
    this.sections.push({
      level,
      number,
      heading,
      text: '',
      citation: buildSectionCitation(
        this.actCitation,
        level,
        number,
        ancestorSegments,
      ),
      breadcrumb: buildBreadcrumb(segments),
      path: buildPath(segments),
      sortOrder: this.nextSortOrder++,
      parentIndex,
    });
    return idx;
  }

  // ---------------------------------------------------------------------------
  // Heading / number extraction from a node's DIRECT <head> child
  // ---------------------------------------------------------------------------

  private headParts(
    $n: cheerio.Cheerio<any>,
    prefixWord: string | null,
  ): { number: string; heading: string | null } {
    const head = $n.children('head').first();
    let no = this.collapse(head.children('no').first().text());
    const heading = this.collapse(head.children('heading').first().text());
    if (prefixWord && no) {
      no = no.replace(new RegExp('^' + prefixWord + '\\s+', 'i'), '').trim();
    }
    return { number: no, heading: heading || null };
  }

  // ---------------------------------------------------------------------------
  // Clause body → flattened text
  // ---------------------------------------------------------------------------

  private clauseText($clause: cheerio.Cheerio<any>): string {
    const lines: string[] = [];
    $clause.contents().each((_, c) => {
      if ((c as any).type === 'text') return;
      const tag = this.tagOf(c);
      if (tag === 'head' || tag === 'parentattributes') return;
      this.renderNode(c, lines);
    });
    return lines.join('\n').trim();
  }

  private renderNode(node: any, lines: string[]): void {
    const tag = this.tagOf(node);
    if (tag === undefined) return; // text node
    const $n = this.$(node);
    const type = $n.attr('type');

    if (tag === 'content' && type && SKIP_CONTENT_TYPES.has(type)) return;
    if (tag === 'historynote' || tag === 'repealed' || tag === 'repealedtxt')
      return;
    if (tag === 'head' || tag === 'parentattributes') return;

    if (tag === 'txt') {
      const t = this.collapse($n.text());
      if (t) lines.push(t);
      return;
    }
    if (tag === 'no' || tag === 'heading') return; // handled by parent

    if ((tag === 'tier' && type === 'subclause') || tag === 'li') {
      const label = this.directNo($n);
      const sub: string[] = [];
      $n.children('block').each((_, b) => this.renderNode(b, sub));
      // some li/tier hold lists directly (no intervening <block>)
      $n.children('list').each((_, l) => this.renderNode(l, sub));
      if (sub.length) sub[0] = label ? `${label} ${sub[0]}` : sub[0];
      else if (label) sub.push(label);
      lines.push(...sub);
      return;
    }
    if (tag === 'list') {
      $n.children('li').each((_, li) => this.renderNode(li, lines));
      return;
    }
    if (tag === 'deflist') {
      $n.children('block').each((_, b) => this.renderNode(b, lines));
      return;
    }
    if (tag === 'block') {
      $n.contents().each((_, c) => {
        if ((c as any).type !== 'text') this.renderNode(c, lines);
      });
      return;
    }
    if (tag === 'note') {
      const sub: string[] = [];
      $n.children('block').each((_, b) => this.renderNode(b, sub));
      if (sub.length) lines.push('Note. ' + sub.join(' '));
      return;
    }
    if (tag === 'table') {
      this.renderTable($n, lines);
      return;
    }
    if (tag === 'pre') {
      // <pre type="auto-inserted"> is a transparent wrapper NSW places around
      // amendment-inserted content — it can hold a <block> (schedule
      // sourceref) OR a full <tier type="subclause"> (e.g. s 16(1)). Recurse
      // through ALL children or wrapped subclauses are silently dropped.
      $n.contents().each((_, c) => {
        if ((c as any).type !== 'text') this.renderNode(c, lines);
      });
      return;
    }
    if (tag === 'content' && type === 'auto-inserted') {
      $n.contents().each((_, c) => {
        if ((c as any).type !== 'text') this.renderNode(c, lines);
      });
      return;
    }

    // Default: recurse so nothing is silently dropped.
    $n.contents().each((_, c) => {
      if ((c as any).type !== 'text') this.renderNode(c, lines);
    });
  }

  /** Read the number label from a node's <head><no> or direct <no>. */
  private directNo($el: cheerio.Cheerio<any>): string {
    let no = $el.children('head').children('no').first();
    if (no.length === 0) no = $el.children('no').first();
    return no.length ? this.collapse(no.text()) : '';
  }

  /** Flatten a CALS <table> to "cell | cell" rows. */
  private renderTable($n: cheerio.Cheerio<any>, lines: string[]): void {
    const h = this.collapse($n.children('heading').first().text());
    if (h) lines.push(h);
    $n.find('row').each((_, row) => {
      const cells: string[] = [];
      this.$(row)
        .children('entry')
        .each((__, e) => {
          cells.push(this.collapse(this.$(e).text()));
        });
      const joined = cells.join(' | ');
      if (joined.replace(/[\s|]/g, '')) lines.push(joined);
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private collapse(s: string): string {
    return s.replace(/\s+/g, ' ').trim();
  }

  private tagOf(node: any): string | undefined {
    return node && (node.tagName || node.name);
  }
}