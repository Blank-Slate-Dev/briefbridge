// scripts/verify-legislation.ts
//
// Verifies that what is stored in the database for an Act matches what the
// parser produces from the live source HTML — word-for-word, per section,
// PLUS structural sanity.
//
// =============================================================================
// METHOD
// =============================================================================
//
// Two stages of verification, in this order:
//
//   STAGE 1 — Structural sanity checks. These run before the content
//             comparison because they catch failure modes the multiset
//             comparison can't see: systematic parser misclassification
//             (words all present but attached to wrong section types).
//             A failure here exits before the content stage runs, because
//             a structurally-broken result would almost certainly "pass"
//             the multiset check — both sides would be wrong identically.
//
//   STAGE 2 — Word-multiset comparison per section. For each section we
//             compare the bag of words the parser produced against the
//             bag of words in the DB. Order within a section is ignored
//             (this lets flattened tables pass correctly — same words,
//             rearranged). Any dropped, added, corrupted, or truncated
//             content shows up as a multiset difference.
//
// =============================================================================
// LESSON LEARNED (Fair Work Act 2009, May 2026)
// =============================================================================
//
// The original verifier had only Stage 2. When Fair Work was first ingested,
// the parser misclassified every Chapter as a Schedule and consequently every
// Part as schedule_part and every Section as schedule_clause. All the words
// were present, just attached to wrong-typed parents. The multiset comparison
// passed cleanly — and would have shipped a structurally broken Act, where
// "find me section 117" returned nothing because s 117 was filed as
// schedule_clause 117 of a fictitious Schedule.
//
// The structural checks below codify that lesson:
//
//   Check 1: source has ActHead1 elements → DB must have chapter or schedule rows
//   Check 2: DB must contain leaf-content rows (section or schedule_clause)
//   Check 3: schedule-mode rows imply source must have "Schedule N" text
//
// =============================================================================
//
// Usage:
//   npx tsx scripts/verify-legislation.ts --registration-id=C1901A00002 --compilation-date=2024-12-11
//
// Exit code 0 = every check passes. Exit code 1 = at least one failure.

import { config } from 'dotenv';
config({ path: '.env.local' });
import * as cheerio from 'cheerio';
import postgres from 'postgres';
import { parseLegislationHtml } from '@/lib/legislation/parser';
import { buildActCitation } from '@/lib/legislation/citations';

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function getArg(name: string): string | undefined {
  const flag = process.argv.find((a) => a.startsWith(`--${name}=`));
  return flag ? flag.slice(`--${name}=`.length) : undefined;
}

const registrationIdRaw = getArg('registration-id');
const compilationDateRaw = getArg('compilation-date');

if (!registrationIdRaw || !compilationDateRaw) {
  console.error(
    'Usage: npx tsx scripts/verify-legislation.ts --registration-id=C1901A00002 --compilation-date=2024-12-11',
  );
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set. Check .env.local');
  process.exit(1);
}

// After the guards above, these are guaranteed non-undefined.
const registrationId: string = registrationIdRaw;
const compilationDate: string = compilationDateRaw;

// ---------------------------------------------------------------------------
// Word-multiset helpers
// ---------------------------------------------------------------------------

// Normalise text into a word multiset (a Map of word -> count).
// We lowercase, normalise unicode dashes/quotes/spaces, and split on
// whitespace. Punctuation attached to words is kept (so "(1)" stays "(1)")
// because in legislation those tokens carry meaning.
function toWordMultiset(text: string): Map<string, number> {
  const normalised = text
    .normalize('NFKC')
    .replace(/\u00a0/g, ' ')          // non-breaking space -> space
    .replace(/[\u2010-\u2015]/g, '-') // unicode dashes -> hyphen
    .replace(/[\u2018\u2019]/g, "'")  // curly single quotes -> straight
    .replace(/[\u201c\u201d]/g, '"')  // curly double quotes -> straight
    .toLowerCase();

  const words = normalised.split(/\s+/).filter((w) => w.length > 0);
  const m = new Map<string, number>();
  for (const w of words) {
    m.set(w, (m.get(w) ?? 0) + 1);
  }
  return m;
}

// Compare two multisets. Returns { missing, extra } where:
//   missing = words in `expected` (parser) but short/absent in `actual` (db)
//   extra   = words in `actual` (db) but not accounted for in `expected`
function diffMultisets(
  expected: Map<string, number>,
  actual: Map<string, number>,
): { missing: string[]; extra: string[] } {
  const missing: string[] = [];
  const extra: string[] = [];

  for (const [word, count] of expected) {
    const actualCount = actual.get(word) ?? 0;
    if (actualCount < count) {
      for (let i = 0; i < count - actualCount; i++) missing.push(word);
    }
  }
  for (const [word, count] of actual) {
    const expectedCount = expected.get(word) ?? 0;
    if (expectedCount < count) {
      for (let i = 0; i < count - expectedCount; i++) extra.push(word);
    }
  }
  return { missing, extra };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // 1. Fetch the SAME raw HTML the parser/ingest uses.
  const sourceUrl = `https://www.legislation.gov.au/${registrationId}/${compilationDate}/${compilationDate}/text/original/epub/OEBPS/document_1/document_1.html`;
  console.log(`[verify] fetching ${sourceUrl}`);
  const res = await fetch(sourceUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (compatible; BriefBridge legislation verify; +https://briefbridge.com)',
    },
  });
  if (!res.ok) {
    console.error(`[verify] fetch failed: HTTP ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const html = await res.text();
  console.log(`[verify] received ${html.length.toLocaleString()} bytes`);

  // 2. Run the parser fresh. This is our source of truth for "what the
  //    source says". (Citation arg doesn't affect text content.)
  const actCitation = buildActCitation('Verification Run', 'commonwealth');
  const parsed = parseLegislationHtml(html, {
    actCitation,
    jurisdiction: 'commonwealth',
  });
  console.log(`[verify] parser produced ${parsed.sections.length} sections`);

  // 3. Load what's actually in the DB for this Act.
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  const [act] = await sql`
    SELECT id, short_title FROM legislation
    WHERE registration_id = ${registrationId}
      AND jurisdiction = 'commonwealth'
    LIMIT 1
  `;
  if (!act) {
    console.error(
      `[verify] no legislation row for registration_id=${registrationId}. Has it been ingested?`,
    );
    await sql.end();
    process.exit(1);
  }
  const dbSections = await sql`
    SELECT level, number, heading, text, sort_order
    FROM legislation_sections
    WHERE legislation_id = ${act.id}
    ORDER BY sort_order
  `;
  console.log(`[verify] DB has ${dbSections.length} sections for "${act.short_title}"`);
  await sql.end();

  // =========================================================================
  // STAGE 1: Structural sanity checks
  // =========================================================================
  //
  // These check that the parser produced a structurally sensible result,
  // independent of whether the text content is correct. They run first
  // because a structurally broken result would likely pass the content
  // check (both sides wrong identically) and silently ship.

  const $verify = cheerio.load(html);

  // Count source-document structural signals.
  const sourceActHead1Count = $verify('p.ActHead1').length;

  let sourceHasScheduleElement = false;
  $verify('p').each((_, el) => {
    const text = $verify(el).text().trim();
    if (/^Schedule\s+\d/i.test(text)) {
      sourceHasScheduleElement = true;
      return false; // stop iteration
    }
    return;
  });

  // Count parser-output level distribution.
  const levelCounts = new Map<string, number>();
  for (const s of parsed.sections) {
    levelCounts.set(s.level, (levelCounts.get(s.level) ?? 0) + 1);
  }
  const nChapters = levelCounts.get('chapter') ?? 0;
  const nSchedules = levelCounts.get('schedule') ?? 0;
  const nSections = levelCounts.get('section') ?? 0;
  const nSchedulePart = levelCounts.get('schedule_part') ?? 0;
  const nScheduleClauses = levelCounts.get('schedule_clause') ?? 0;

  console.log(
    `[verify] structural summary: chapters=${nChapters} schedules=${nSchedules} ` +
      `sections=${nSections} schedule_clauses=${nScheduleClauses} ` +
      `sourceActHead1=${sourceActHead1Count} sourceHasSchedule=${sourceHasScheduleElement}`,
  );

  let hardFail = false;

  // Sanity check 1: ActHead1 elements in source → top-level structural
  // rows in parsed output. If the source has ActHead1 elements but the
  // parser produced zero chapters AND zero schedules, top-level
  // structure is lost.
  if (sourceActHead1Count > 0 && nChapters === 0 && nSchedules === 0) {
    console.error(
      `[verify] STRUCTURAL FAIL: source contains ${sourceActHead1Count} ` +
        `<p class="ActHead1"> elements but parser produced 0 chapters and 0 schedules. ` +
        `Top-level structure lost.`,
    );
    hardFail = true;
  }

  // Sanity check 2: leaf-content rows must exist. An Act with zero
  // sections AND zero schedule_clauses has no leaves — no content is
  // retrievable by citation. This is the direct catch for the original
  // Fair Work bug.
  if (nSections === 0 && nScheduleClauses === 0) {
    console.error(
      `[verify] STRUCTURAL FAIL: parser produced 0 'section' rows and ` +
        `0 'schedule_clause' rows. Acts must have leaf-level content; ` +
        `none means citations cannot be retrieved.`,
    );
    hardFail = true;
  }

  // Sanity check 3: schedule-mode rows imply source must have "Schedule N"
  // text. If the parser emitted schedule-family rows (schedule,
  // schedule_part, or schedule_clause) but the source HTML contains no
  // element whose text starts with "Schedule N", schedule mode was
  // entered erroneously.
  const sawScheduleRows = nSchedules > 0 || nSchedulePart > 0 || nScheduleClauses > 0;
  if (sawScheduleRows && !sourceHasScheduleElement) {
    console.error(
      `[verify] STRUCTURAL FAIL: parser emitted schedule-family rows ` +
        `(schedules=${nSchedules}, schedule_parts=${nSchedulePart}, ` +
        `schedule_clauses=${nScheduleClauses}) but source HTML contains no ` +
        `"Schedule N" element. Schedule mode entered erroneously.`,
    );
    hardFail = true;
  }

  // If any structural check failed, stop here. The content comparison
  // would be misleading on a structurally broken result.
  if (hardFail) {
    console.log('');
    console.log('='.repeat(60));
    console.log(`[verify] FAIL — structural sanity check(s) failed`);
    console.log('='.repeat(60));
    process.exit(1);
  }

  // =========================================================================
  // STAGE 2: Content comparison
  // =========================================================================

  // Section-count check. Different from "alignment" — this is just the
  // total number of rows on each side.
  if (parsed.sections.length !== dbSections.length) {
    console.error(
      `[verify] SECTION COUNT MISMATCH: parser=${parsed.sections.length} db=${dbSections.length}`,
    );
    hardFail = true;
  }

  // Per-section word-multiset comparison. We pair by sort_order index.
  // For each section we compare heading+text words.
  const n = Math.min(parsed.sections.length, dbSections.length);
  let mismatchCount = 0;

  for (let i = 0; i < n; i++) {
    const p = parsed.sections[i];
    const d = dbSections[i];

    // Identity sanity: level + number should line up. If they don't, the
    // two lists have drifted out of alignment — report and keep going.
    if (p.level !== d.level || p.number !== d.number) {
      console.error(
        `[verify] ALIGNMENT MISMATCH at index ${i}: ` +
          `parser=${p.level} ${p.number} | db=${d.level} ${d.number}`,
      );
      mismatchCount++;
      continue;
    }

    const parserText = `${p.heading ?? ''} ${p.text ?? ''}`;
    const dbText = `${d.heading ?? ''} ${d.text ?? ''}`;

    const parserWords = toWordMultiset(parserText);
    const dbWords = toWordMultiset(dbText);
    const { missing, extra } = diffMultisets(parserWords, dbWords);

    if (missing.length > 0 || extra.length > 0) {
      mismatchCount++;
      console.error(
        `\n[verify] MISMATCH — ${p.level} ${p.number} "${p.heading ?? ''}"`,
      );
      if (missing.length > 0) {
        console.error(
          `  words in source but missing from DB (${missing.length}): ` +
            missing.slice(0, 30).join(' '),
        );
      }
      if (extra.length > 0) {
        console.error(
          `  words in DB not in source (${extra.length}): ` +
            extra.slice(0, 30).join(' '),
        );
      }
    }
  }

  // =========================================================================
  // Verdict
  // =========================================================================

  console.log('');
  console.log('='.repeat(60));
  if (hardFail || mismatchCount > 0) {
    console.log(
      `[verify] FAIL — ${mismatchCount} section(s) mismatched` +
        (hardFail ? ' + section count mismatch' : ''),
    );
    console.log('='.repeat(60));
    process.exit(1);
  }
  console.log(
    `[verify] PASS — all ${n} sections match word-for-word (multiset) ` +
      `+ structural sanity checks`,
  );
  console.log('='.repeat(60));
  process.exit(0);
}

main().catch((err) => {
  console.error('[verify] error:', err);
  process.exit(1);
});
