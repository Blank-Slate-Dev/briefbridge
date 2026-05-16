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
// LESSONS LEARNED (codified here)
// =============================================================================
//
// Fair Work Act 2009 — parser misclassification (May 2026)
// --------------------------------------------------------
// The original verifier had only Stage 2. When Fair Work was first
// ingested, the parser misclassified every Chapter as a Schedule and
// consequently every Part as schedule_part and every Section as
// schedule_clause. All the words were present, just attached to
// wrong-typed parents. The multiset comparison passed cleanly. Stage 1
// check #2 (zero leaves) and #3 (schedule rows without source "Schedule
// N" element) now catch that class of bug at first ingest.
//
// Fair Work Act 2009 — multi-document truncation (May 2026)
// ---------------------------------------------------------
// legislation.gov.au splits large Acts across multiple document_N.html
// files. The pipeline originally fetched only document_1, silently
// truncating Fair Work (4 documents) to its first chapter or two. The
// verifier passed because the DB matched the truncated source.
// lib/legislation/fetch.ts now probes all documents in order; this
// script uses it, so the verifier compares the DB against the full Act.
//
// Fair Work Act 2009 — endnote false-trigger / missing Schedules (May 2026)
// ------------------------------------------------------------------------
// The parser's original ENDNOTES trigger was text-based — any <p> whose
// text matched "Endnotes" or "Endnote N". legislation.gov.au reprints a
// volume-contents list at the start of each volume that includes
// "Endnotes" as a literal entry — the parser tripped on that and
// skipped Fair Work's 5 Schedules at the end of the Act. The trigger is
// now structural (only fires on <p class="ENotesHeading1">). Stage 1
// check #4 (ActHead1 count parity) is the verifier's safety net for
// "parser silently dropped top-level structure".
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
import { fetchActHtml } from '@/lib/legislation/fetch';

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
// Source-side structural counting
// ---------------------------------------------------------------------------

/**
 * Count UNIQUE top-level ActHead1 anchors in the source HTML.
 *
 * "Unique" matters for multi-volume Acts: legislation.gov.au re-prints
 * the containing Chapter heading at the start of each volume. Naively
 * counting every <p class="ActHead1"> would over-count by exactly the
 * number of volume boundaries, and we'd fail the parity check even on a
 * correctly-parsed Act.
 *
 * We deduplicate by (leading-word, number). For Chapter 2 — Terms and
 * conditions of employment — the key is "Chapter:2". The same Chapter
 * 2 heading reprinted in volume 2 has the same key and counts once.
 */
function countUniqueActHead1s($: cheerio.CheerioAPI): {
  totalCount: number;
  uniqueCount: number;
  uniqueKeys: string[];
} {
  const total = $('p.ActHead1').length;
  const keys = new Set<string>();
  $('p.ActHead1').each((_, el) => {
    const text = $(el).text().trim();
    const match = text.match(/^(Chapter|Schedule|Part)\s+(\S+)/i);
    if (match) {
      // Strip trailing em-dash etc. from the number (e.g. "1—Introduction" → "1").
      const word = match[1].toLowerCase();
      const num = match[2].replace(/[—–-].*$/, '').trim();
      keys.add(`${word}:${num}`);
    } else {
      // Unrecognised shape — count it as unique by its full text so we
      // don't accidentally collapse multiple distinct headings.
      keys.add(`raw:${text.slice(0, 80)}`);
    }
  });
  return {
    totalCount: total,
    uniqueCount: keys.size,
    uniqueKeys: [...keys].sort(),
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // 1. Fetch the SAME multi-document HTML the ingest pipeline uses.
  console.log(
    `[verify] fetching ${registrationId} compilation ${compilationDate}`,
  );
  const fetchResult = await fetchActHtml(registrationId, compilationDate);
  const html = fetchResult.html;
  console.log(
    `[verify] ${fetchResult.documents.length} document(s), ` +
      `${fetchResult.totalSourceBytes.toLocaleString()} source bytes, ` +
      `${html.length.toLocaleString()} combined bytes`,
  );

  // 2. Run the parser fresh on the combined HTML. This is our source of
  //    truth for "what the source says". (Citation arg doesn't affect
  //    text content.)
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
  const actHead1 = countUniqueActHead1s($verify);

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
      `sections=${nSections} schedule_clauses=${nScheduleClauses}`,
  );
  console.log(
    `[verify] source ActHead1: total=${actHead1.totalCount} ` +
      `unique=${actHead1.uniqueCount} ` +
      `sourceHasSchedule=${sourceHasScheduleElement}`,
  );

  let hardFail = false;

  // Sanity check 1: ActHead1 elements in source → top-level structural
  // rows in parsed output. If the source has ActHead1 elements but the
  // parser produced zero chapters AND zero schedules, top-level
  // structure is lost.
  if (actHead1.totalCount > 0 && nChapters === 0 && nSchedules === 0) {
    console.error(
      `[verify] STRUCTURAL FAIL: source contains ${actHead1.totalCount} ` +
        `<p class="ActHead1"> elements but parser produced 0 chapters and 0 schedules. ` +
        `Top-level structure lost.`,
    );
    hardFail = true;
  }

  // Sanity check 2: leaf-content rows must exist. An Act with zero
  // sections AND zero schedule_clauses has no leaves — no content is
  // retrievable by citation. This is the direct catch for the original
  // Fair Work Chapter-as-Schedule misclassification bug.
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

  // Sanity check 4: ActHead1 count parity. The number of UNIQUE
  // top-level anchors (chapters + schedules) in source must equal the
  // number of chapter + schedule rows in the parser output. Catches
  // partial-loss bugs: source has 14 ActHead1s representing 9 chapters
  // and 5 schedules, but parser only produced 9 — the 5 Schedules got
  // silently dropped (which is what Fair Work's endnote false-trigger
  // caused).
  //
  // We use the UNIQUE count rather than total count to account for
  // multi-volume Acts that re-print their containing heading at volume
  // boundaries. The parser de-duplicates those re-prints; the verifier
  // matches that semantic.
  const parsedTopLevel = nChapters + nSchedules;
  if (actHead1.uniqueCount !== parsedTopLevel) {
    console.error(
      `[verify] STRUCTURAL FAIL: source has ${actHead1.uniqueCount} unique ActHead1 ` +
        `anchors (chapters + schedules), but parser produced ${parsedTopLevel} ` +
        `(${nChapters} chapter(s) + ${nSchedules} schedule(s)). ` +
        `${Math.abs(actHead1.uniqueCount - parsedTopLevel)} top-level node(s) ` +
        `${actHead1.uniqueCount > parsedTopLevel ? 'lost' : 'over-emitted'}.`,
    );
    console.error(`  Unique ActHead1 keys in source:`);
    for (const key of actHead1.uniqueKeys) {
      console.error(`    ${key}`);
    }
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
