// scripts/verify-legislation.ts
//
// Verifies that what is stored in the database for an Act matches what the
// parser produces from the live source HTML — word-for-word, per section,
// PLUS structural sanity, PLUS coverage of source content.
//
// =============================================================================
// METHOD
// =============================================================================
//
// Three stages of verification, in this order:
//
//   STAGE 0 — Source-vs-parser coverage check. Diffs the word-multiset of
//             the raw source HTML's plain text against the word-multiset of
//             the parser's output (all section headings + body text, all
//             concatenated). Surfaces content the parser is silently
//             dropping. Informational only — does NOT fail the run, because
//             we expect some gap (tables outside <p>, etc.) and want to see
//             its size and shape before deciding what to fix.
//             Added May 2026 after discovering that Stage 1+2 alone proves
//             only "DB matches parser", not "DB matches source".
//
//   STAGE 1 — Structural sanity checks. These run before the content
//             comparison because they catch failure modes the multiset
//             comparison can't see: systematic parser misclassification
//             (words all present but attached to wrong section types), or
//             body text dropped on the floor.
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
// Parser misclassified every Chapter as a Schedule. Stage 1 check #2
// (zero leaves) and #3 (schedule rows without source "Schedule N"
// element) now catch that class of bug at first ingest.
//
// Fair Work Act 2009 — multi-document truncation (May 2026)
// ---------------------------------------------------------
// legislation.gov.au splits large Acts across multiple document_N.html
// files. lib/legislation/fetch.ts now probes all documents in order.
//
// Fair Work Act 2009 — endnote false-trigger (May 2026)
// -----------------------------------------------------
// Parser tripped on the word "Endnotes" appearing in a volume-contents
// list and skipped legitimate Schedules. Trigger is now structural
// (ENotesHeading1 class). Stage 1 check #4 (ActHead1 parity) is the
// safety net.
//
// Corporations Act 2001 — orphan body text (May 2026)
// ---------------------------------------------------
// Parser dropped 1,863 "Body" and "TLPnoteright" paragraphs on the
// floor because they appeared inside Guide chapters that had no
// numbered section yet. Parser now attaches body text to the nearest
// structural ancestor (chapter/part/division) when no section is
// current. Stage 1 check #5 (orphan-warning count must be zero) is the
// verifier safety net.
//
// Privacy Act 1988 — invisible content gap (May 2026)
// ----------------------------------------------------
// Stages 1 and 2 only prove "DB matches parser", not "DB matches
// source". Privacy Act s 16A's table (NDB Scheme exceptions) was
// silently absent from BOTH the parser output and the DB because the
// parser walks <p> elements only — table cells in <td> outside <p>
// were invisible. Both sides agreed, both sides were wrong, verifier
// said PASS. Stage 0 added to detect this class of bug by comparing
// against the raw source plain text.
//
// =============================================================================
//
// Usage:
//   npx tsx scripts/verify-legislation.ts --registration-id=C1901A00002 --compilation-date=2024-12-11
//
// Exit code 0 = every check passes. Exit code 1 = at least one failure.
// Stage 0 output does not affect exit code (informational only).

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

function toWordMultiset(text: string): Map<string, number> {
  const normalised = text
    .normalize('NFKC')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .toLowerCase();

  const words = normalised.split(/\s+/).filter((w) => w.length > 0);
  const m = new Map<string, number>();
  for (const w of words) {
    m.set(w, (m.get(w) ?? 0) + 1);
  }
  return m;
}

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
// STAGE 0 helpers — source-vs-parser coverage
// ---------------------------------------------------------------------------

interface SourceExtraction {
  text: string;
  excludedClassCounts: Map<string, number>;
}

function extractSourceTextLenient(
  $: cheerio.CheerioAPI,
): SourceExtraction {
  let endnotesAnchor: cheerio.Cheerio<any> | null = null;
  const eNotes = $('p.ENotesHeading1').first();
  if (eNotes.length > 0) {
    endnotesAnchor = eNotes;
  }

  const SKIP_CLASSES = new Set([
    'TOC1', 'TOC2', 'TOC3', 'TOC4', 'TOC5',
    'Header',
    'ShortT', 'LongT', 'CompiledActNo',
  ]);

  const excludedClassCounts = new Map<string, number>();

  const $clone = cheerio.load($.html());

  if (endnotesAnchor && endnotesAnchor.length > 0) {
    const eClass = endnotesAnchor.attr('class') || '';
    const cloneENotes = $clone(`p.${eClass.split(/\s+/).join('.')}`).first();
    if (cloneENotes.length > 0) {
      cloneENotes.nextAll().remove();
      cloneENotes.remove();
    }
  }

  for (const cls of SKIP_CLASSES) {
    const matches = $clone(`p.${cls}`);
    if (matches.length > 0) {
      excludedClassCounts.set(cls, matches.length);
      matches.remove();
    }
  }

  const body = $clone('body');
  const text = body.length > 0 ? body.text() : $clone.html() ?? '';

  return { text, excludedClassCounts };
}

interface ParserTextExtraction {
  text: string;
}

function extractParserText(
  sections: { heading: string | null; text: string }[],
): ParserTextExtraction {
  const parts: string[] = [];
  for (const s of sections) {
    if (s.heading) parts.push(s.heading);
    if (s.text) parts.push(s.text);
  }
  return { text: parts.join('\n') };
}

interface Stage0Report {
  sourceWordCount: number;
  parserWordCount: number;
  coveragePct: number;
  missingWordCount: number;
  extraWordCount: number;
  topMissingWords: Array<{ word: string; count: number }>;
  topExtraWords: Array<{ word: string; count: number }>;
  excludedFromSource: Map<string, number>;
}

function runStage0(
  $: cheerio.CheerioAPI,
  parsedSections: { heading: string | null; text: string }[],
): Stage0Report {
  const sourceExtraction = extractSourceTextLenient($);
  const parserExtraction = extractParserText(parsedSections);

  const sourceWords = toWordMultiset(sourceExtraction.text);
  const parserWords = toWordMultiset(parserExtraction.text);

  const sourceTotal = [...sourceWords.values()].reduce((a, b) => a + b, 0);
  const parserTotal = [...parserWords.values()].reduce((a, b) => a + b, 0);

  const { missing, extra } = diffMultisets(sourceWords, parserWords);

  const missingFreq = new Map<string, number>();
  for (const w of missing) {
    missingFreq.set(w, (missingFreq.get(w) ?? 0) + 1);
  }
  const topMissing = [...missingFreq.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);

  const extraFreq = new Map<string, number>();
  for (const w of extra) {
    extraFreq.set(w, (extraFreq.get(w) ?? 0) + 1);
  }
  const topExtra = [...extraFreq.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return {
    sourceWordCount: sourceTotal,
    parserWordCount: parserTotal,
    coveragePct: sourceTotal === 0 ? 100 : (parserTotal / sourceTotal) * 100,
    missingWordCount: missing.length,
    extraWordCount: extra.length,
    topMissingWords: topMissing,
    topExtraWords: topExtra,
    excludedFromSource: sourceExtraction.excludedClassCounts,
  };
}

function printStage0Report(report: Stage0Report): void {
  console.log('');
  console.log('='.repeat(60));
  console.log(`[verify] STAGE 0 — source-vs-parser coverage (informational)`);
  console.log('='.repeat(60));
  console.log(
    `  Source word count (after lenient filter): ${report.sourceWordCount.toLocaleString()}`,
  );
  console.log(
    `  Parser word count (headings + body):      ${report.parserWordCount.toLocaleString()}`,
  );
  console.log(
    `  Coverage:                                 ${report.coveragePct.toFixed(2)}%`,
  );
  console.log(
    `  Missing words (in source, not parser):    ${report.missingWordCount.toLocaleString()}`,
  );
  console.log(
    `  Extra words (in parser, not source):      ${report.extraWordCount.toLocaleString()}`,
  );

  if (report.excludedFromSource.size > 0) {
    console.log('');
    console.log(`  Source content classes EXCLUDED from this diff:`);
    const sorted = [...report.excludedFromSource.entries()].sort(
      (a, b) => b[1] - a[1],
    );
    for (const [cls, count] of sorted) {
      console.log(`    ${cls.padEnd(20)} ${count.toString().padStart(5)} <p> elements`);
    }
  }

  if (report.topMissingWords.length > 0) {
    console.log('');
    console.log(
      `  Top 50 words present in source but missing from parser output:`,
    );
    console.log(`  (these point to where the parser is dropping content)`);
    console.log('');
    for (const { word, count } of report.topMissingWords) {
      console.log(`    ${count.toString().padStart(6)}  ${word}`);
    }
  }

  if (report.topExtraWords.length > 0) {
    console.log('');
    console.log(
      `  Top 20 words present in parser output but not in source:`,
    );
    console.log(`  (these are usually parser-introduced glue text or normalisation artefacts)`);
    console.log('');
    for (const { word, count } of report.topExtraWords) {
      console.log(`    ${count.toString().padStart(6)}  ${word}`);
    }
  }

  console.log('');
  console.log(
    `  NOTE: Stage 0 is informational — it does not fail the run. A low`,
  );
  console.log(
    `  coverage % or many missing words indicates the parser is dropping`,
  );
  console.log(
    `  content (commonly: tables outside <p>, or unrecognised OPC classes).`,
  );
  console.log('='.repeat(60));
}

// ---------------------------------------------------------------------------
// Source-side structural counting
// ---------------------------------------------------------------------------

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
      const word = match[1].toLowerCase();
      const num = match[2].replace(/[—–-].*$/, '').trim();
      keys.add(`${word}:${num}`);
    } else {
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

  const actCitation = buildActCitation('Verification Run', 'commonwealth');
  const parsed = parseLegislationHtml(html, {
    actCitation,
    jurisdiction: 'commonwealth',
  });
  console.log(`[verify] parser produced ${parsed.sections.length} sections`);
  console.log(`[verify] parser warnings: ${parsed.warnings.length}`);

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
  // STAGE 0: Source-vs-parser coverage (informational)
  // =========================================================================

  const $stage0 = cheerio.load(html);
  const stage0 = runStage0(
    $stage0,
    parsed.sections.map((s) => ({ heading: s.heading, text: s.text })),
  );
  printStage0Report(stage0);

  // =========================================================================
  // STAGE 1: Structural sanity checks
  // =========================================================================

  const $verify = cheerio.load(html);

  const actHead1 = countUniqueActHead1s($verify);

  let sourceHasScheduleElement = false;
  $verify('p').each((_, el) => {
    const text = $verify(el).text().trim();
    if (/^Schedule\s+\d/i.test(text)) {
      sourceHasScheduleElement = true;
      return false;
    }
    return;
  });

  const levelCounts = new Map<string, number>();
  for (const s of parsed.sections) {
    levelCounts.set(s.level, (levelCounts.get(s.level) ?? 0) + 1);
  }
  const nChapters = levelCounts.get('chapter') ?? 0;
  const nSchedules = levelCounts.get('schedule') ?? 0;
  const nSections = levelCounts.get('section') ?? 0;
  const nSchedulePart = levelCounts.get('schedule_part') ?? 0;
  const nScheduleClauses = levelCounts.get('schedule_clause') ?? 0;

  console.log('');
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

  if (actHead1.totalCount > 0 && nChapters === 0 && nSchedules === 0) {
    console.error(
      `[verify] STRUCTURAL FAIL: source contains ${actHead1.totalCount} ` +
        `<p class="ActHead1"> elements but parser produced 0 chapters and 0 schedules. ` +
        `Top-level structure lost.`,
    );
    hardFail = true;
  }

  if (nSections === 0 && nScheduleClauses === 0) {
    console.error(
      `[verify] STRUCTURAL FAIL: parser produced 0 'section' rows and ` +
        `0 'schedule_clause' rows. Acts must have leaf-level content; ` +
        `none means citations cannot be retrieved.`,
    );
    hardFail = true;
  }

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

  if (parsed.warnings.length > 0) {
    console.error(
      `[verify] STRUCTURAL FAIL: parser emitted ${parsed.warnings.length} ` +
        `warning(s). Content was dropped during parsing. First 10:`,
    );
    for (const w of parsed.warnings.slice(0, 10)) {
      console.error(`    ${w}`);
    }
    if (parsed.warnings.length > 10) {
      console.error(`    ... and ${parsed.warnings.length - 10} more`);
    }
    hardFail = true;
  }

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

  if (parsed.sections.length !== dbSections.length) {
    console.error(
      `[verify] SECTION COUNT MISMATCH: parser=${parsed.sections.length} db=${dbSections.length}`,
    );
    hardFail = true;
  }

  const n = Math.min(parsed.sections.length, dbSections.length);
  let mismatchCount = 0;

  for (let i = 0; i < n; i++) {
    const p = parsed.sections[i];
    const d = dbSections[i];

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
  console.log(`         Stage 0 coverage was informational — see report above`);
  console.log('='.repeat(60));
  process.exit(0);
}

main().catch((err) => {
  console.error('[verify] error:', err);
  process.exit(1);
});
