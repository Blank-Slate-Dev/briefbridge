// lib/legislation/parser.ts
//
// HTML → hierarchical section tree parser for legislation.gov.au content.
//
// =============================================================================
// STRATEGY
// =============================================================================
//
// The Federal Register HTML uses SEMANTIC CSS class names that map to
// structural depth. The MEANING of each level depends on the Act's text:
//
//   ActHead1  → Chapter heading (e.g. Fair Work Act "Chapter 1—Introduction")
//                OR Schedule heading (e.g. Privacy Act "Schedule 1—APPs")
//                Dispatched by the leading word of the heading text.
//   ActHead2  → Part heading (e.g. "Part II—Interpretation")
//                OR Schedule Part (when inside a schedule)
//   ActHead3  → Division heading
//   ActHead4  → Subdivision heading
//   ActHead5  → Section heading (e.g. "6 Interpretation")
//                OR Schedule Clause (when inside a schedule)
//
//   Inside each ActHead, child <span>s name the components:
//     CharPartNo / CharPartText  → Part/Chapter/Schedule number + text
//     CharDivNo / CharDivText    → Division number + text
//     CharSubdNo / CharSubdText  → Subdivision number + text
//     CharSectno                 → Section number (heading text is the rest)
//
//   Body content (under each section or clause):
//     <p class="subsection">     → "(1) ... body ..."
//     <p class="subsection2">    → deeper nested subsection
//     <p class="paragraph">      → "(a) ... body ..."
//     <p class="paragraphsub">   → "(i) ... body ..."
//     <p class="Definition">     → defined-term entries
//     <p class="Penalty">        → penalty notes
//     <p class="notetext">       → note annotations
//
// =============================================================================
// SCHEDULE HANDLING
// =============================================================================
//
// The Privacy Act's Schedule 1 contains the Australian Privacy Principles
// (APPs 1-13). The structure is:
//
//   Schedule 1 — Australian Privacy Principles      [ActHead1]
//     Part 1 — Consideration of personal info...    [ActHead2 inside schedule]
//       APP 1 — open and transparent management...  [ActHead5 inside schedule]
//
// Key insight: the SAME CSS classes (ActHead2, ActHead5) are reused for
// different conceptual levels when inside a schedule. The parser tracks
// `insideSchedule` as state and dispatches accordingly:
//
//   ActHead2 outside schedule → 'part'
//   ActHead2 inside schedule  → 'schedule_part'
//   ActHead5 outside schedule → 'section'
//   ActHead5 inside schedule  → 'schedule_clause'
//
// =============================================================================
// CHAPTER HANDLING
// =============================================================================
//
// Acts like the Fair Work Act 2009 use Chapters as their top-level
// structural division. In the HTML, these appear as ActHead1 elements
// with text starting "Chapter N—...", not "Schedule N—...". The parser
// distinguishes them by text content and emits a `chapter` row that
// behaves as a parent for Parts beneath it, WITHOUT setting
// insideSchedule. This keeps real Sections as `section` rows rather
// than misclassified `schedule_clause` rows.
//
// =============================================================================

import * as cheerio from 'cheerio';
import type {
  LegislationSectionLevel,
  LegislationJurisdiction,
} from '@/lib/db/schema';
import {
  buildSectionCitation,
  buildBreadcrumb,
  buildPath,
  type CitationSegment,
} from './citations';

// =============================================================================
// Result types
// =============================================================================

/**
 * A parsed section ready for DB insertion. The parser returns a flat
 * array of these in document order. The `parentSectionId` is null on
 * the parser output (the DB layer assigns IDs and links them up post-
 * insertion).
 *
 * `parentIndex` is the index of this section's parent within the same
 * output array. -1 means "top-level child of the Act". The ingest
 * script uses this to set FK references after inserting in order.
 */
export interface ParsedSection {
  level: LegislationSectionLevel;
  number: string;
  heading: string | null;
  text: string;
  citation: string;
  breadcrumb: string;
  path: string;
  sortOrder: number;
  parentIndex: number; // -1 = top-level
}

export interface ParseResult {
  sections: ParsedSection[];
  // Compilation metadata extracted from the document header.
  compilationDate: string | null; // ISO date if found
  compilationNumber: number | null;
  // Warnings the parser emitted during parsing. Surface these in the
  // ingest script's output so we can audit a run.
  warnings: string[];
}

// =============================================================================
// Public entry point
// =============================================================================

export interface ParseOptions {
  /** Pre-built act-level citation, e.g. 'Privacy Act 1988 (Cth)'. */
  actCitation: string;
  /** Jurisdiction (for citation building). */
  jurisdiction: LegislationJurisdiction;
}

export function parseLegislationHtml(
  html: string,
  opts: ParseOptions,
): ParseResult {
  const $ = cheerio.load(html);

  const state = new ParserState(opts.actCitation, opts.jurisdiction);

  // Extract compilation metadata from the document header.
  state.compilationDate = findCompilationDate($);
  state.compilationNumber = findCompilationNumber($);

  // Walk all <p> elements in document order.
  const allParagraphs = $('p');
  console.error(`[parser-diag] total <p> elements found: ${allParagraphs.length}`);

  let processedCount = 0;
  let elementsAfterLastSection = 0;
  let lastSectionAtIndex = -1;

  allParagraphs.each((idx, el) => {
    processedCount++;
    const $el = $(el);
    const cls = ($el.attr('class') || '').trim();
    if (!cls) {
      // Untagged paragraph — skip silently.
      return;
    }
    const sectionsBeforeHandle = state.sections.length;
    state.handleElement($, $el, cls);
    if (state.sections.length > sectionsBeforeHandle) {
      lastSectionAtIndex = idx;
      elementsAfterLastSection = 0;
    } else {
      elementsAfterLastSection++;
    }
  });

  console.error(`[parser-diag] processed ${processedCount} <p> elements`);
  console.error(`[parser-diag] last section was added at element index: ${lastSectionAtIndex}`);
  console.error(`[parser-diag] state phase at end: ${state.phase}`);
  console.error(`[parser-diag] hierarchy stack depth at end: ${state.hierarchyStack.length}`);
  console.error(`[parser-diag] insideSchedule at end: ${state.insideSchedule}`);

  return {
    sections: state.sections,
    compilationDate: state.compilationDate,
    compilationNumber: state.compilationNumber,
    warnings: state.warnings,
  };
}

// =============================================================================
// Parser state machine
// =============================================================================

/**
 * Walks <p> elements top-to-bottom. Three phases:
 *
 *   1. PRE_BODY  — before the first ActHead1/ActHead2. TOC + metadata. Skip.
 *   2. BODY      — main content. Build the hierarchy.
 *   3. ENDNOTES  — after the body. Skip.
 *
 * The phase transitions:
 *   - PRE_BODY → BODY  when we see the first ActHead1 or ActHead2.
 *   - BODY → ENDNOTES  when we see an "Endnotes" / "Endnote N" heading.
 *
 * Inside BODY, an additional `insideSchedule` flag controls whether
 * ActHead2 / ActHead5 emit 'part'/'section' (false) or
 * 'schedule_part'/'schedule_clause' (true). Chapter rows do NOT set
 * insideSchedule — they're a top-level Act-structural concept.
 */
class ParserState {
  phase: 'PRE_BODY' | 'BODY' | 'ENDNOTES' = 'PRE_BODY';
  sections: ParsedSection[] = [];
  warnings: string[] = [];

  // Current hierarchy stack — the path of ancestors from root to current
  // section. Each entry is the INDEX into `this.sections`.
  hierarchyStack: number[] = [];

  // True once we've entered a Schedule. Flipped on by ActHead1 whose
  // text starts "Schedule"; flipped off by ActHead1 whose text starts
  // "Chapter" (Acts can interleave Chapters and Schedules at the top
  // level — Fair Work is Chapter-only; most Cth Acts are
  // Part/Schedule-only; some have both).
  insideSchedule = false;

  // Track whether we've seen body content. Currently unused but kept
  // for parity with the prior parser shape; can be removed in cleanup.
  hasSeenBodySection = false;

  // Compilation metadata, set externally by the parser entry point.
  compilationDate: string | null = null;
  compilationNumber: number | null = null;

  // For sort_order assignment.
  nextSortOrder = 0;

  constructor(
    private readonly actCitation: string,
    private readonly jurisdiction: LegislationJurisdiction,
  ) {}

  handleElement(
    $: cheerio.CheerioAPI,
    $el: cheerio.Cheerio<any>,
    cls: string,
  ): void {
    const text = $el.text().trim();

    // Endnote detection: ONLY match "Endnotes" / "Endnote N" headings,
    // and only when we're already in BODY. Plain "Note 1" is body
    // annotation text, not an endnotes section heading.
    if (
      this.phase === 'BODY' &&
      (/^endnotes?$/i.test(text) || /^endnote\s+\d+/i.test(text))
    ) {
      debug(`[endnotes detected] heading: "${text}"`);
      this.phase = 'ENDNOTES';
      return;
    }

    // Tabletext handling depends on phase:
    //   - ENDNOTES phase: skip (legislation history / amendment history tables
    //     are noise we don't want appended to the last section).
    //   - BODY phase: capture as body text of the current section. Commonwealth
    //     Acts use Tabletext for in-section content tables (e.g. s 2 of every
    //     Act has a Commencement table; s 9 of the AIC Act has a table listing
    //     provisions that confer privacy functions). These rows used to be
    //     silently dropped, costing real content fidelity.
    //   - PRE_BODY phase: skip. The HTML's <head> may use Tabletext for the
    //     "About this compilation" section before we've seen any structural
    //     element to attach text to.
    if (cls === 'Tabletext') {
      if (this.phase === 'BODY' && text.length > 0) {
        this.appendToCurrentSection(text);
      }
      return;
    }

    if (this.phase === 'ENDNOTES') {
      return;
    }

    // Skip TOC and chrome regardless of phase.
    if (
      cls === 'TOC2' ||
      cls === 'TOC3' ||
      cls === 'TOC4' ||
      cls === 'TOC5' ||
      cls === 'Header'
    ) {
      return;
    }

    // ActHead1 = Chapter OR Schedule, dispatched by leading word.
    // Either way, switches us out of PRE_BODY.
    if (cls === 'ActHead1') {
      this.phase = 'BODY';
      this.handleActHead1($, $el);
      return;
    }

    // ActHead2 = Part (or Schedule Part, when insideSchedule).
    // Switches us out of PRE_BODY.
    if (cls === 'ActHead2') {
      this.phase = 'BODY';
      this.handleActHead2($, $el);
      return;
    }

    // Inside PRE_BODY, ignore everything except ActHead1/ActHead2.
    if (this.phase === 'PRE_BODY') {
      return;
    }

    // BODY phase: dispatch on class.
    switch (cls) {
      case 'ActHead3':
        this.handleActHead3($, $el);
        return;
      case 'ActHead4':
        this.handleActHead4($, $el);
        return;
      case 'ActHead5':
        this.handleActHead5($, $el);
        return;
      case 'subsection':
      case 'subsection2':
      case 'paragraph':
      case 'paragraphsub':
      case 'paragraphsub-sub':   // deeper-indent paragraph variant
      case 'Definition':
      case 'Penalty':
      case 'notetext':
      case 'notepara':           // note continuation paragraphs
      case 'notemargin':         // marginal note text
      case 'SubsectionHead':     // in-section subheadings ("Agencies", "What is X?")
      case 'BoxText':            // Guide-to-this-Part box paragraphs
      case 'BoxPara':            // Guide bullets inside a Box
      case 'BoxHeadItalic':      // italic subheading inside a Box
      case 'BoxList':            // Box bullet/list items
      case 'TableHeading':       // headings above body-content tables
      case 'Tablea':             // table-cell variant
      case 'Tablei':             // italic table-cell variant
      case 'Formula':            // formula blocks (e.g. in tax / GST Acts)
      case 'SOText':             // schedule-of-... formatting (multi-schedule Acts)
      case 'SOPara':
      case 'SOBullet':
      case 'SOHeadItalic':       // italic heading inside an SO block
      case 'SOTextNote':         // notes within SO blocks
      case 'noteToPara':         // notes attached to a specific paragraph
        // All body-text classes append verbatim to the current section.
        // Tables flatten into prose; not pretty for display, but preserves
        // every word for retrieval.
        this.appendToCurrentSection(text);
        return;
      default:
        // Unknown class. Append to current section text as a safety net.
        if (this.currentSectionIndex !== null && text.length > 0) {
          this.appendToCurrentSection(text);
        }
        console.error(`[parser-unknown-class] "${cls}", text="${truncate(text, 100)}"`);
    }
  }

  // ---------------------------------------------------------------------------
  // Heading handlers
  // ---------------------------------------------------------------------------

  /**
   * ActHead1 = Chapter (Fair Work-style) or Schedule (Privacy Act-style).
   *
   * Dispatches on the leading word of the heading text. If the text
   * starts with "Chapter", emit a chapter row and DO NOT set
   * insideSchedule — Chapters contain real Parts and Sections. If the
   * text starts with "Schedule", emit a schedule row and set
   * insideSchedule = true so subsequent Parts/Sections become
   * schedule_parts/schedule_clauses.
   *
   * Markup (Privacy Act 1988 Schedule 1):
   *   <p class="ActHead1">
   *     <span class="CharPartNo">Schedule</span>
   *     <span class="CharPartNo">&nbsp;</span>
   *     <span class="CharPartNo">1</span>             ← the number
   *     <span>—</span>
   *     <span class="CharPartText">Australian Privacy Principles</span>
   *   </p>
   *
   * Markup (Fair Work Act 2009 Chapter 1):
   *   <p class="ActHead1">
   *     <span class="CharPartNo">Chapter</span>
   *     <span class="CharPartNo">&nbsp;</span>
   *     <span class="CharPartNo">1</span>
   *     <span>—</span>
   *     <span class="CharPartText">Introduction</span>
   *   </p>
   */
  private handleActHead1(
    $: cheerio.CheerioAPI,
    $el: cheerio.Cheerio<any>,
  ): void {
    const fullText = $el.text().trim();

    if (/^Chapter\b/i.test(fullText)) {
      const noSpans = $el.find('.CharPartNo').toArray();
      const noText = extractNumberFromSpans($, noSpans, /^chapter$/i);
      const textSpan = $el.find('.CharPartText').first().text().trim();
      const chapterNumber = noText || extractChapterNumberFromText(fullText);
      const chapterHeading =
        textSpan || chapterHeadingFromText(fullText, chapterNumber);

      this.popHierarchyTo([]);
      this.insideSchedule = false;
      this.addSection('chapter', chapterNumber, chapterHeading || null);
      this.hasSeenBodySection = true;
      debug(`[ActHead1/Chapter] ${chapterNumber}: "${chapterHeading}"`);
      return;
    }

    if (/^Schedule\b/i.test(fullText)) {
      const noSpans = $el.find('.CharPartNo').toArray();
      const noText = extractNumberFromSpans($, noSpans, /^schedule$/i);
      const textSpan = $el.find('.CharPartText').first().text().trim();
      const scheduleNumber = noText || extractScheduleNumberFromText(fullText);
      const scheduleHeading =
        textSpan || scheduleHeadingFromText(fullText, scheduleNumber);

      this.popHierarchyTo([]);
      this.insideSchedule = true;
      this.addSection('schedule', scheduleNumber, scheduleHeading || null);
      debug(`[ActHead1/Schedule] ${scheduleNumber}: "${scheduleHeading}"`);
      return;
    }

    // Unrecognised ActHead1 shape. Warn but capture as schedule (legacy
    // fallback) so content isn't lost. Review the parser if this fires
    // on a real Act — it almost certainly means a new top-level concept
    // (e.g. "Part X" appearing at ActHead1) the parser should handle
    // explicitly.
    this.warnings.push(
      `ActHead1 with unexpected leading word: "${truncate(fullText, 80)}". ` +
        `Captured as 'schedule' as fallback.`,
    );
    const noSpans = $el.find('.CharPartNo').toArray();
    const noText = extractNumberFromSpans(
      $,
      noSpans,
      /^(part|schedule|chapter)$/i,
    );
    const textSpan = $el.find('.CharPartText').first().text().trim();
    const scheduleNumber = noText || extractScheduleNumberFromText(fullText);
    const scheduleHeading =
      textSpan || scheduleHeadingFromText(fullText, scheduleNumber);
    this.popHierarchyTo([]);
    this.insideSchedule = true;
    this.addSection('schedule', scheduleNumber, scheduleHeading || null);
    debug(
      `[ActHead1/Unknown->Schedule fallback] ${scheduleNumber}: "${scheduleHeading}"`,
    );
  }

  /**
   * ActHead2 = Part (outside schedule) or Schedule Part (inside schedule).
   *
   * Real markup (Privacy Act Part I):
   *   <p class="ActHead2">
   *     <span class="CharPartNo">Part</span>
   *     <span class="CharPartNo">&nbsp;</span>
   *     <span class="CharPartNo">I</span>      ← the actual number
   *     <span>—</span>
   *     <span class="CharPartText">Preliminary</span>
   *   </p>
   */
  private handleActHead2(
    $: cheerio.CheerioAPI,
    $el: cheerio.Cheerio<any>,
  ): void {
    const partNoSpans = $el.find('.CharPartNo').toArray();
    const partNoText = extractNumberFromSpans(
      $,
      partNoSpans,
      /^(part|schedule)$/i,
    );
    const partText = $el.find('.CharPartText').first().text().trim();
    const fullText = $el.text().trim();

    // Defensive: some Acts encode their schedules using ActHead2 with
    // the leading word "Schedule" rather than a distinct ActHead1.
    // Detect that case and re-dispatch as a schedule.
    const isScheduleStyle = /^Schedule\b/i.test(fullText);
    if (isScheduleStyle && !this.insideSchedule) {
      // Treat this as a schedule heading. Same flow as ActHead1.
      const schNum = partNoText || extractScheduleNumberFromText(fullText);
      const schHeading = partText || scheduleHeadingFromText(fullText, schNum);
      this.popHierarchyTo([]);
      this.insideSchedule = true;
      this.addSection('schedule', schNum, schHeading || null);
      debug(`[ActHead2/Schedule via ActHead2] ${schNum}: "${schHeading}"`);
      return;
    }

    const partNumber = partNoText || extractPartNumberFromText(fullText);
    const partHeading = partText || partHeadingFromText(fullText, partNumber);

    if (this.insideSchedule) {
      // Schedule Part. Parent must be the schedule.
      this.popHierarchyTo(['schedule']);
      this.addSection('schedule_part', partNumber, partHeading || null);
      debug(`[ActHead2/SchedulePart] ${partNumber}: "${partHeading}"`);
    } else {
      // Top-level Act Part. May sit under a Chapter if one exists.
      this.popHierarchyTo(['chapter']);
      this.addSection('part', partNumber, partHeading || null);
      this.hasSeenBodySection = true;
      debug(`[ActHead2/Part] ${partNumber}: "${partHeading}"`);
    }
  }

  private handleActHead3(
    $: cheerio.CheerioAPI,
    $el: cheerio.Cheerio<any>,
  ): void {
    const divNoSpans = $el.find('.CharDivNo').toArray();
    const divNoText = extractNumberFromSpans($, divNoSpans, /^division$/i);
    const divText = $el.find('.CharDivText').first().text().trim();
    const fullText = $el.text().trim();

    const divNumber = divNoText || extractDivisionNumberFromText(fullText);
    const divHeading = divText || divisionHeadingFromText(fullText, divNumber);

    // Divisions can live under Chapters, Parts, or schedule_parts.
    this.popHierarchyTo(['chapter', 'part', 'schedule_part']);
    this.addSection('division', divNumber, divHeading || null);
    debug(`[ActHead3/Division] ${divNumber}: "${divHeading}"`);
  }

  private handleActHead4(
    $: cheerio.CheerioAPI,
    $el: cheerio.Cheerio<any>,
  ): void {
    const subdNoRaw = $el.find('.CharSubdNo').first().text().trim();
    const subdNoText = subdNoRaw.replace(/^Subdivision\s+/i, '').trim();
    const subdText = $el.find('.CharSubdText').first().text().trim();
    const fullText = $el.text().trim();

    const subNumber =
      subdNoText || extractSubdivisionNumberFromText(fullText);
    const subHeading =
      subdText || subdivisionHeadingFromText(fullText, subNumber);

    this.popHierarchyTo(['chapter', 'part', 'schedule_part', 'division']);
    this.addSection('subdivision', subNumber, subHeading || null);
    debug(`[ActHead4/Subdivision] ${subNumber}: "${subHeading}"`);
  }

  /**
   * ActHead5 = Section (outside schedule) or Schedule Clause (inside schedule).
   *
   * Markup:
   *   <p class="ActHead5">
   *     <span class="CharSectno">1</span>
   *     <span>&nbsp; </span>
   *     <span>Short title</span>
   *   </p>
   */
  private handleActHead5(
    $: cheerio.CheerioAPI,
    $el: cheerio.Cheerio<any>,
  ): void {
    const sectNumber = $el.find('.CharSectno').first().text().trim();
    const fullText = $el.text().trim();

    // Strip the section number from the start of the full text.
    let sectHeading = fullText;
    if (sectNumber) {
      const pattern = new RegExp(`^${escapeRegex(sectNumber)}\\s*`, '');
      sectHeading = fullText.replace(pattern, '').trim();
    }

    if (this.insideSchedule) {
      // Schedule Clause. Parent must be a schedule_part (or, if the
      // schedule has no Parts, the schedule itself).
      this.popHierarchyTo(['schedule', 'schedule_part']);
      this.addSection(
        'schedule_clause',
        sectNumber,
        sectHeading || null,
      );
      this.hasSeenBodySection = true;
      debug(`[ActHead5/ScheduleClause] ${sectNumber}: "${sectHeading}"`);
    } else {
      // Top-level Act Section. May sit under chapter/part/division/subdivision.
      this.popHierarchyTo(['chapter', 'part', 'division', 'subdivision']);
      this.addSection('section', sectNumber, sectHeading || null);
      this.hasSeenBodySection = true;
      debug(`[ActHead5/Section] ${sectNumber}: "${sectHeading}"`);
    }
  }

  // ---------------------------------------------------------------------------
  // Body text aggregation
  // ---------------------------------------------------------------------------

  /**
   * The "current section" is the most recent leaf-level entry in the
   * hierarchy. For Acts that's a `section`; for schedules it's a
   * `schedule_clause`. Body paragraphs append to whichever is on top.
   */
  private get currentSectionIndex(): number | null {
    for (let i = this.hierarchyStack.length - 1; i >= 0; i--) {
      const sec = this.sections[this.hierarchyStack[i]];
      if (
        sec &&
        (sec.level === 'section' || sec.level === 'schedule_clause')
      ) {
        return this.hierarchyStack[i];
      }
    }
    return null;
  }

  private appendToCurrentSection(text: string): void {
    if (text.length === 0) return;
    const idx = this.currentSectionIndex;
    if (idx === null) {
      this.warnings.push(
        `Body text encountered with no current section: "${truncate(text, 80)}"`,
      );
      return;
    }
    const section = this.sections[idx];
    section.text = section.text.length === 0 ? text : `${section.text}\n\n${text}`;
  }

  // ---------------------------------------------------------------------------
  // Hierarchy stack management
  // ---------------------------------------------------------------------------

  /**
   * Pop hierarchy frames until the top of the stack is one of the
   * allowed parent levels (or empty).
   */
  private popHierarchyTo(allowedParentLevels: LegislationSectionLevel[]): void {
    while (this.hierarchyStack.length > 0) {
      const topIdx = this.hierarchyStack[this.hierarchyStack.length - 1];
      const topLevel = this.sections[topIdx].level;
      if (allowedParentLevels.includes(topLevel)) break;
      this.hierarchyStack.pop();
    }
  }

  /**
   * Append a new section, link it to its parent in the stack, compute
   * citation/breadcrumb/path, and push it on the stack.
   */
  private addSection(
    level: LegislationSectionLevel,
    number: string,
    heading: string | null,
  ): void {
    const parentIndex =
      this.hierarchyStack.length > 0
        ? this.hierarchyStack[this.hierarchyStack.length - 1]
        : -1;

    // Build the segment chain: ancestors + this new section.
    const ancestorSegments: CitationSegment[] = this.hierarchyStack.map((idx) => ({
      level: this.sections[idx].level,
      number: this.sections[idx].number,
    }));
    const segments: CitationSegment[] = [
      ...ancestorSegments,
      { level, number },
    ];

    const citation = buildSectionCitation(
      this.actCitation,
      level,
      number,
      ancestorSegments,
    );
    const breadcrumb = buildBreadcrumb(segments);
    const path = buildPath(segments);

    const newIndex = this.sections.length;
    this.sections.push({
      level,
      number,
      heading,
      text: '',
      citation,
      breadcrumb,
      path,
      sortOrder: this.nextSortOrder++,
      parentIndex,
    });

    this.hierarchyStack.push(newIndex);
  }
}

// =============================================================================
// Metadata extraction helpers
// =============================================================================

function findCompilationDate($: cheerio.CheerioAPI): string | null {
  let result: string | null = null;
  $('p').each((i, el) => {
    if (i > 100) return false;
    const text = $(el).text().trim();
    const match = text.match(/Compilation date:\s*(\d{1,2})\s+(\w+)\s+(\d{4})/i);
    if (match) {
      const day = parseInt(match[1], 10);
      const monthName = match[2];
      const year = parseInt(match[3], 10);
      const monthIndex = MONTH_NAMES.findIndex(
        (m) => m.toLowerCase() === monthName.toLowerCase(),
      );
      if (monthIndex >= 0 && day >= 1 && day <= 31) {
        const monthStr = String(monthIndex + 1).padStart(2, '0');
        const dayStr = String(day).padStart(2, '0');
        result = `${year}-${monthStr}-${dayStr}`;
        return false;
      }
    }
  });
  return result;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function findCompilationNumber($: cheerio.CheerioAPI): number | null {
  let result: number | null = null;
  $('p').each((i, el) => {
    if (i > 100) return false;
    const text = $(el).text().trim();
    const match = text.match(/Compilation No\.?\s*(\d+)/i);
    if (match) {
      result = parseInt(match[1], 10);
      return false;
    }
  });
  return result;
}

// =============================================================================
// Text extraction helpers
// =============================================================================

/**
 * Given a list of CharPartNo/CharDivNo spans, return the LAST one whose
 * text isn't (a) the literal heading word like "Part"/"Division" and
 * (b) just whitespace/nbsp. That's the actual number.
 */
function extractNumberFromSpans(
  $: cheerio.CheerioAPI,
  spans: any[],
  skipPattern: RegExp,
): string {
  for (let i = spans.length - 1; i >= 0; i--) {
    const text = $(spans[i]).text().trim();
    if (text.length === 0) continue;
    if (skipPattern.test(text)) continue;
    return text;
  }
  return '';
}

function extractPartNumberFromText(text: string): string {
  // Matches Part numbers like "II", "1", "3A", and Fair Work-style
  // "1-1", "2-4A" etc. (dash-separated Chapter-Part numbering).
  const match = text.match(/^Part\s+([IVXLCDM\d]+(?:[-‑–][0-9A-Z]+)?[A-Z]?)/i);
  return match?.[1] ?? '';
}

function partHeadingFromText(text: string, partNumber: string): string {
  if (!partNumber) return text.trim();
  const pattern = new RegExp(
    `^Part\\s+${escapeRegex(partNumber)}\\s*[—–-]?\\s*`,
    'i',
  );
  return text.replace(pattern, '').trim();
}

function extractDivisionNumberFromText(text: string): string {
  const match = text.match(/^Division\s+(\S+)/i);
  return match?.[1]?.replace(/[—–-].*$/, '').trim() ?? '';
}

function divisionHeadingFromText(text: string, divNumber: string): string {
  if (!divNumber) return text.trim();
  const pattern = new RegExp(
    `^Division\\s+${escapeRegex(divNumber)}\\s*[—–-]?\\s*`,
    'i',
  );
  return text.replace(pattern, '').trim();
}

function extractSubdivisionNumberFromText(text: string): string {
  const match = text.match(/^Subdivision\s+([A-Z]+|\d+)/i);
  return match?.[1] ?? '';
}

function subdivisionHeadingFromText(text: string, subNumber: string): string {
  if (!subNumber) return text.trim();
  const pattern = new RegExp(
    `^Subdivision\\s+${escapeRegex(subNumber)}\\s*[—–-]?\\s*`,
    'i',
  );
  return text.replace(pattern, '').trim();
}

function extractChapterNumberFromText(text: string): string {
  const match = text.match(/^Chapter\s+(\S+)/i);
  return match?.[1]?.replace(/[—–-].*$/, '').trim() ?? '';
}

function chapterHeadingFromText(text: string, chapterNumber: string): string {
  if (!chapterNumber) return text.trim();
  const pattern = new RegExp(
    `^Chapter\\s+${escapeRegex(chapterNumber)}\\s*[—–-]?\\s*`,
    'i',
  );
  return text.replace(pattern, '').trim();
}

function extractScheduleNumberFromText(text: string): string {
  const match = text.match(/^Schedule\s+(\S+)/i);
  return match?.[1]?.replace(/[—–-].*$/, '').trim() ?? '';
}

function scheduleHeadingFromText(text: string, scheduleNumber: string): string {
  if (!scheduleNumber) return text.trim();
  const pattern = new RegExp(
    `^Schedule\\s+${escapeRegex(scheduleNumber)}\\s*[—–-]?\\s*`,
    'i',
  );
  return text.replace(pattern, '').trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 3) + '...' : s;
}

// =============================================================================
// Debug logging
// =============================================================================

const DEBUG = process.env.DEBUG_LEGISLATION_PARSER === '1';

function debug(message: string): void {
  if (!DEBUG) return;
  // eslint-disable-next-line no-console
  console.log(`[parser] ${message}`);
}