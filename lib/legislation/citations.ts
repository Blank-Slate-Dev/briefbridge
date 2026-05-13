// lib/legislation/citations.ts
//
// AGLC4 citation builders for legislation.
//
// The Australian Guide to Legal Citation 4th ed. specifies:
//   - Act:         'Privacy Act 1988 (Cth)'
//   - Section:     'Privacy Act 1988 (Cth) s 6'
//   - Subsection:  'Privacy Act 1988 (Cth) s 6(1)'
//   - Paragraph:   'Privacy Act 1988 (Cth) s 6(1)(a)'
//   - Schedule:    'Privacy Act 1988 (Cth) sch 1'
//   - Sch clause:  'Privacy Act 1988 (Cth) sch 1 cl 11'
//   - Sch pt + cl: 'Privacy Act 1988 (Cth) sch 1 pt 4 cl 11'  (some authors)
//
// Note on schedule clauses: AGLC4 itself permits `sch 1 cl 11` without
// the intervening Part reference. In practice, lawyers often shorten to
// `sch 1 cl 11` because the Part is rarely ambiguous once you know the
// clause number. We include the Part in the BREADCRUMB (for navigation)
// but omit it from the canonical CITATION to keep citation strings
// shorter and matching common usage.
//
// Jurisdiction abbreviations (AGLC4 rule 3.1.4):
//   Commonwealth                → (Cth)
//   New South Wales             → (NSW)
//   Victoria                    → (Vic)
//   Queensland                  → (Qld)
//   Western Australia           → (WA)
//   South Australia             → (SA)
//   Tasmania                    → (Tas)
//   Australian Capital Territory → (ACT)
//   Northern Territory          → (NT)
//
// =============================================================================
// Ancestor context — why citations and paths take a segment array
// =============================================================================
//
// A schedule clause's citation cannot be computed from level + number
// alone — you have to know which schedule it belongs to. That's why the
// builders below take a `segments` array (the full ancestor chain from
// root) rather than just the leaf's own level + number.
//
// Two builders need this context:
//   - buildSectionCitation: needs schedule number for schedule_clause/schedule_part
//   - buildPath: needs short prefixes inside schedules to avoid path
//     collisions between Act-level Parts and Schedule-level Parts
//
// buildBreadcrumb already took segments. buildSectionCitation now takes
// an optional `ancestors` array; when called for a schedule descendant,
// the schedule number is read from there.

import type {
  LegislationJurisdiction,
  LegislationSectionLevel,
} from '@/lib/db/schema';

export interface CitationSegment {
  level: LegislationSectionLevel;
  number: string;
}

// ---------------------------------------------------------------------------
// Jurisdiction abbreviations
// ---------------------------------------------------------------------------

const JURISDICTION_ABBREVIATION: Record<LegislationJurisdiction, string> = {
  commonwealth: 'Cth',
  nsw: 'NSW',
  vic: 'Vic',
  qld: 'Qld',
  wa: 'WA',
  sa: 'SA',
  tas: 'Tas',
  act: 'ACT',
  nt: 'NT',
};

// ---------------------------------------------------------------------------
// Act-level citation
// ---------------------------------------------------------------------------

/**
 * Build the AGLC4 citation for an Act.
 *
 * @example
 *   buildActCitation('Privacy Act 1988', 'commonwealth')
 *   // -> 'Privacy Act 1988 (Cth)'
 *
 *   buildActCitation('Civil Liability Act 2002', 'nsw')
 *   // -> 'Civil Liability Act 2002 (NSW)'
 */
export function buildActCitation(
  shortTitle: string,
  jurisdiction: LegislationJurisdiction,
): string {
  const abbrev = JURISDICTION_ABBREVIATION[jurisdiction];
  return `${shortTitle} (${abbrev})`;
}

// ---------------------------------------------------------------------------
// Section-level citation
// ---------------------------------------------------------------------------

/**
 * Build the AGLC4 citation for a specific section within an Act.
 *
 * Citation prefixes by level:
 *   - 'chapter'        → ' ch 2'
 *   - 'part'           → ' pt II'
 *   - 'division'       → ' div 1'
 *   - 'subdivision'    → ' subdiv A'
 *   - 'section'        → ' s 6'
 *   - 'subsection'     → ' s 6(1)' (collapsed back to section + sub form)
 *   - 'schedule'       → ' sch 1'
 *   - 'schedule_part'  → ' sch 1 pt 4'   (needs ancestors for schedule num)
 *   - 'schedule_clause' → ' sch 1 cl 11' (needs ancestors for schedule num)
 *
 * `ancestors` is the chain of containing nodes (excluding the leaf itself),
 * required for schedule descendants so we can read the schedule number.
 *
 * @example
 *   buildSectionCitation('Privacy Act 1988 (Cth)', 'section', '6')
 *   // -> 'Privacy Act 1988 (Cth) s 6'
 *
 *   buildSectionCitation('Privacy Act 1988 (Cth)', 'part', 'II')
 *   // -> 'Privacy Act 1988 (Cth) pt II'
 *
 *   buildSectionCitation('Privacy Act 1988 (Cth)', 'schedule_clause', '11',
 *     [{ level: 'schedule', number: '1' }, { level: 'schedule_part', number: '4' }])
 *   // -> 'Privacy Act 1988 (Cth) sch 1 cl 11'
 */
export function buildSectionCitation(
  actCitation: string,
  level: LegislationSectionLevel,
  number: string,
  ancestorsOrParentSectionNumber: CitationSegment[] | string = [],
): string {
  // Back-compat: the old signature passed parentSectionNumber as a 4th
  // arg (string) for subsection citations. New signature passes ancestors
  // (array) for schedule descendants. We accept both.
  const ancestors: CitationSegment[] = Array.isArray(
    ancestorsOrParentSectionNumber,
  )
    ? ancestorsOrParentSectionNumber
    : [];
  const parentSectionNumber =
    typeof ancestorsOrParentSectionNumber === 'string'
      ? ancestorsOrParentSectionNumber
      : undefined;

  switch (level) {
    case 'chapter':
      return `${actCitation} ch ${number}`;
    case 'part':
      return `${actCitation} pt ${number}`;
    case 'division':
      return `${actCitation} div ${number}`;
    case 'subdivision':
      return `${actCitation} subdiv ${number}`;
    case 'section':
      return `${actCitation} s ${number}`;
    case 'subsection':
      // Subsections cite as `s {section}({sub})`. If we know the parent
      // section, build the full form. Otherwise just append the subsection
      // number to whatever was passed.
      if (parentSectionNumber) {
        return `${actCitation} s ${parentSectionNumber}${number}`;
      }
      return `${actCitation} ${number}`;
    case 'schedule':
      return `${actCitation} sch ${number}`;
    case 'schedule_part': {
      // sch {N} pt {M}
      const scheduleNumber = findAncestorNumber(ancestors, 'schedule');
      if (!scheduleNumber) {
        // Defensive: a schedule_part should never appear without a
        // schedule ancestor. If it does, fall back to bare 'pt {N}'.
        return `${actCitation} pt ${number}`;
      }
      return `${actCitation} sch ${scheduleNumber} pt ${number}`;
    }
    case 'schedule_clause': {
      // sch {N} cl {M}. We deliberately omit the intervening Part — it's
      // permitted by AGLC4 and matches common practice. The breadcrumb
      // surfaces the Part for navigation.
      const scheduleNumber = findAncestorNumber(ancestors, 'schedule');
      if (!scheduleNumber) {
        return `${actCitation} cl ${number}`;
      }
      return `${actCitation} sch ${scheduleNumber} cl ${number}`;
    }
    default: {
      // Exhaustiveness check — TS will complain if a new level is added
      // to the union and not handled here.
      const _exhaustive: never = level;
      return `${actCitation} ${String(_exhaustive)} ${number}`;
    }
  }
}

function findAncestorNumber(
  ancestors: CitationSegment[],
  level: LegislationSectionLevel,
): string | null {
  for (const a of ancestors) {
    if (a.level === level) return a.number;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Breadcrumb building
// ---------------------------------------------------------------------------

/**
 * Build a human-readable breadcrumb for UI display.
 *
 * Format: 'Part II > Division 1 > s 6'
 *         'Sch 1 > Pt 4 > Cl 11'      (schedule descendants)
 *
 * Takes an array of (level, number) segments from root to leaf.
 *
 * @example
 *   buildBreadcrumb([
 *     { level: 'part', number: 'II' },
 *     { level: 'division', number: '1' },
 *     { level: 'section', number: '6' },
 *   ])
 *   // -> 'Part II > Division 1 > s 6'
 *
 *   buildBreadcrumb([
 *     { level: 'schedule', number: '1' },
 *     { level: 'schedule_part', number: '4' },
 *     { level: 'schedule_clause', number: '11' },
 *   ])
 *   // -> 'Sch 1 > Pt 4 > Cl 11'
 */
export function buildBreadcrumb(segments: CitationSegment[]): string {
  return segments.map(formatSegmentForBreadcrumb).join(' > ');
}

function formatSegmentForBreadcrumb(segment: CitationSegment): string {
  switch (segment.level) {
    case 'chapter':
      return `Chapter ${segment.number}`;
    case 'part':
      return `Part ${segment.number}`;
    case 'division':
      return `Division ${segment.number}`;
    case 'subdivision':
      return `Subdivision ${segment.number}`;
    case 'section':
      return `s ${segment.number}`;
    case 'subsection':
      return segment.number; // e.g. '(1)' or '(1)(a)'
    case 'schedule':
      return `Sch ${segment.number}`;
    case 'schedule_part':
      return `Pt ${segment.number}`;
    case 'schedule_clause':
      return `Cl ${segment.number}`;
    default: {
      const _exhaustive: never = segment.level;
      return String(_exhaustive);
    }
  }
}

// ---------------------------------------------------------------------------
// Path slug building
// ---------------------------------------------------------------------------

/**
 * Build the materialized path slug for fast subtree queries.
 *
 * Each segment is a short identifier. Joined by dots.
 *
 * Inside a schedule, we use SHORTER PREFIXES to avoid collisions with
 * Act-level Parts that share the same number. Example:
 *
 *   Privacy Act has Part II (Roman) AND Schedule 1 has Part 1 (Arabic).
 *   Without prefix differentiation:
 *     part_2   ← Act Part II
 *     part_1   ← Schedule 1 Part 1
 *   Two distinct things, both queryable via `LIKE 'part_%'`. Bad.
 *
 *   With schedule prefixes:
 *     part_II               ← Act Part II
 *     sch_1.pt_1            ← Schedule 1 Part 1
 *     sch_1.pt_1.cl_1       ← APP 1
 *   No collision; you can scope a subtree query to `sch_1.%`.
 *
 * @example
 *   buildPath([
 *     { level: 'part', number: 'II' },
 *     { level: 'division', number: '1' },
 *     { level: 'section', number: '6' },
 *   ])
 *   // -> 'part_II.division_1.section_6'
 *
 *   buildPath([
 *     { level: 'schedule', number: '1' },
 *     { level: 'schedule_part', number: '4' },
 *     { level: 'schedule_clause', number: '11' },
 *   ])
 *   // -> 'sch_1.pt_4.cl_11'
 */
export function buildPath(segments: CitationSegment[]): string {
  return segments.map(formatSegmentForPath).join('.');
}

function formatSegmentForPath(segment: CitationSegment): string {
  const num = sanitizeForPath(segment.number);
  switch (segment.level) {
    case 'chapter':
      return `chapter_${num}`;
    case 'part':
      return `part_${num}`;
    case 'division':
      return `division_${num}`;
    case 'subdivision':
      return `subdivision_${num}`;
    case 'section':
      return `section_${num}`;
    case 'subsection':
      return `subsection_${num}`;
    case 'schedule':
      return `sch_${num}`;
    case 'schedule_part':
      return `pt_${num}`;
    case 'schedule_clause':
      return `cl_${num}`;
    default: {
      const _exhaustive: never = segment.level;
      return `${String(_exhaustive)}_${num}`;
    }
  }
}

function sanitizeForPath(value: string): string {
  // Strip spaces, parens, special chars. Keep alphanumerics + dashes.
  return value.replace(/[^a-zA-Z0-9-]/g, '');
}