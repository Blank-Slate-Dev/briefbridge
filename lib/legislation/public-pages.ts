// lib/legislation/public-pages.ts
//
// Data helpers for the PUBLIC legislation SEO pages
// (/legislation/[jurisdiction]/[actSlug] and .../s/[section]).
//
// Design decisions (verified against real data, 19 Jul 2026):
//   - Pages are generated for `level = 'section'` rows with a CLEAN single
//     section number (^[A-Za-z0-9.]+$) and non-empty text. The corpus also
//     contains range rows ("10–11A"), comma lists ("101, 102") and empty
//     numbers — these are repealed/omitted stubs with no research value and
//     are exactly the thin pages the SEO plan excludes.
//   - Act URLs are jurisdiction-scoped: /legislation/nsw/civil-liability-act-2002.
//     Slug = slugified short_title (which includes the year, so collisions
//     within a jurisdiction are practically impossible; any dupe is skipped).
//   - INDEXATION TIER: only acts in PRIORITY_ACT_SLUGS are `index` in v1.
//     Everything else renders with noindex until enriched (thin-page
//     protection per the SEO playbook).
//
// Uses the app connection (@/lib/db). All corpus tables have public-read
// RLS policies, so the restricted role can read them.

import { and, asc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/lib/db';

// -----------------------------------------------------------------------------
// Slugs
// -----------------------------------------------------------------------------

/** "Civil Liability Act 2002" -> "civil-liability-act-2002" */
export function slugifyAct(shortTitle: string): string {
  return shortTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Clean single-section numbers only (e.g. "5O", "10A", "12.3"). */
export const CLEAN_SECTION_RE = /^[A-Za-z0-9.]+$/;

/** URL form of a section number — lowercased ("5O" -> "5o"). */
export function sectionToUrl(number: string): string {
  return number.toLowerCase();
}

// -----------------------------------------------------------------------------
// Indexation tier — priority acts that are `index` from day one.
// Everything else is noindex until enriched. Extend deliberately.
// -----------------------------------------------------------------------------

export const PRIORITY_ACT_SLUGS = new Set<string>([
  // NSW
  'civil-liability-act-2002',
  'crimes-act-1900',
  'evidence-act-1995',
  'limitation-act-1969',
  'succession-act-2006',
  'conveyancing-act-1919',
  'residential-tenancies-act-2010',
  'workers-compensation-act-1987',
  'motor-accident-injuries-act-2017',
  'defamation-act-2005',
  // Commonwealth
  'corporations-act-2001',
  'family-law-act-1975',
  'fair-work-act-2009',
  'competition-and-consumer-act-2010',
  'bankruptcy-act-1966',
  'migration-act-1958',
  'income-tax-assessment-act-1997',
  'privacy-act-1988',
]);

export function isPriorityAct(slug: string): boolean {
  return PRIORITY_ACT_SLUGS.has(slug);
}

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export interface PublicAct {
  id: string;
  shortTitle: string;
  longTitle: string | null;
  jurisdiction: string; // 'nsw' | 'commonwealth'
  citation: string | null;
  attributionText: string | null;
  slug: string;
}

export interface PublicSectionListItem {
  number: string;
  heading: string | null;
  urlNumber: string;
}

export interface PublicSection {
  id: string;
  number: string;
  heading: string | null;
  text: string;
  citation: string | null;
  breadcrumb: string | null;
}

// -----------------------------------------------------------------------------
// Queries
// -----------------------------------------------------------------------------

/** URL jurisdiction segment ('nsw' | 'cth') -> DB jurisdiction value. */
export function urlJurisdictionToDb(
  seg: string,
): 'nsw' | 'commonwealth' | null {
  if (seg === 'nsw') return 'nsw';
  if (seg === 'cth') return 'commonwealth';
  return null;
}
export function dbJurisdictionToUrl(j: string): string {
  return j === 'commonwealth' ? 'cth' : j;
}

/**
 * Find an in-force Act by jurisdiction + slug. Because slugs aren't stored,
 * we narrow candidates in SQL with a derived slug expression. Returns null
 * if not found (page should 404).
 */
export async function getActBySlug(
  urlJurisdiction: string,
  slug: string,
): Promise<PublicAct | null> {
  const dbJurisdiction = urlJurisdictionToDb(urlJurisdiction);
  if (!dbJurisdiction) return null;

  const rows = await db
    .select({
      id: schema.legislation.id,
      shortTitle: schema.legislation.shortTitle,
      longTitle: schema.legislation.longTitle,
      jurisdiction: schema.legislation.jurisdiction,
      citation: schema.legislation.citation,
      attributionText: schema.legislation.attributionText,
    })
    .from(schema.legislation)
    .where(
      and(
        eq(schema.legislation.jurisdiction, dbJurisdiction),
        eq(schema.legislation.inForce, true),
        sql`lower(regexp_replace(${schema.legislation.shortTitle}, '[^a-zA-Z0-9]+', '-', 'g')) = ${slug}`,
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return { ...row, slug };
}

/**
 * List the clean, page-worthy sections of an Act (for the Act TOC page).
 * Ordered by document order (sort_order).
 */
export async function listActSections(
  legislationId: string,
): Promise<PublicSectionListItem[]> {
  const rows = await db
    .select({
      number: schema.legislationSections.number,
      heading: schema.legislationSections.heading,
    })
    .from(schema.legislationSections)
    .where(
      and(
        eq(schema.legislationSections.legislationId, legislationId),
        eq(schema.legislationSections.level, 'section'),
        sql`${schema.legislationSections.text} != ''`,
        sql`${schema.legislationSections.number} ~ '^[A-Za-z0-9.]+$'`,
      ),
    )
    .orderBy(asc(schema.legislationSections.sortOrder));

  // Dedupe on number (defensive — first occurrence wins).
  const seen = new Set<string>();
  const out: PublicSectionListItem[] = [];
  for (const r of rows) {
    if (seen.has(r.number)) continue;
    seen.add(r.number);
    out.push({
      number: r.number,
      heading: r.heading,
      urlNumber: sectionToUrl(r.number),
    });
  }
  return out;
}

/**
 * Fetch one section by Act + URL number (case-insensitive match on the
 * stored number). Returns null if not found or not page-worthy.
 */
export async function getSection(
  legislationId: string,
  urlNumber: string,
): Promise<PublicSection | null> {
  const rows = await db
    .select({
      id: schema.legislationSections.id,
      number: schema.legislationSections.number,
      heading: schema.legislationSections.heading,
      text: schema.legislationSections.text,
      citation: schema.legislationSections.citation,
      breadcrumb: schema.legislationSections.breadcrumb,
    })
    .from(schema.legislationSections)
    .where(
      and(
        eq(schema.legislationSections.legislationId, legislationId),
        eq(schema.legislationSections.level, 'section'),
        sql`lower(${schema.legislationSections.number}) = ${urlNumber.toLowerCase()}`,
        sql`${schema.legislationSections.text} != ''`,
      ),
    )
    .orderBy(asc(schema.legislationSections.sortOrder))
    .limit(1);

  const row = rows[0];
  if (!row || !CLEAN_SECTION_RE.test(row.number)) return null;
  return row;
}

/**
 * Neighbouring sections (same Act, nearest by sort_order) for the
 * "Related sections" block. Cheap contextual internal linking.
 */
export async function getNeighbourSections(
  legislationId: string,
  sectionNumber: string,
  count = 6,
): Promise<PublicSectionListItem[]> {
  const all = await listActSections(legislationId);
  const idx = all.findIndex((s) => s.number === sectionNumber);
  if (idx === -1) return all.slice(0, count);
  const half = Math.floor(count / 2);
  const start = Math.max(0, idx - half);
  return all.slice(start, start + count + 1).filter((s) => s.number !== sectionNumber);
}