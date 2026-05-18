// scripts/filter-tier1-acts.ts
//
// Filters scripts/output/cth-acts-in-force.csv down to a curated
// "tier 1" list — Acts a NSW commercial / commercial-litigation
// barrister cites multiple times a year.
//
// The tier-1 list is hardcoded below (see TIER_1_TITLES). The script
// matches each tier-1 entry against the full Cth Acts CSV using:
//   1. Exact title match (case-insensitive, trimmed)
//   2. Fallback: title contains the search string (case-insensitive)
//   3. If multiple matches in fallback, the FIRST one is taken and a
//      warning is logged (operator should verify manually)
//   4. If no match, the entry is reported as unmatched
//
// Writes scripts/output/tier-1-acts.csv with the same columns as the
// source CSV, in tier-1 order. Also prints a summary of matched,
// fuzzy-matched, and unmatched entries to stderr.

import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const INPUT_CSV = join(process.cwd(), 'scripts', 'output', 'cth-acts-in-force.csv');
const OUTPUT_CSV = join(process.cwd(), 'scripts', 'output', 'tier-1-acts.csv');

// =============================================================================
// Tier-1 list — 35 Acts
// =============================================================================
//
// Match strings are designed to match the official Federal Register title.
// Where my mental model name differs from official (e.g. "ASIC Act 2001"
// vs "Australian Securities and Investments Commission Act 2001"), the
// official version is used here.

const TIER_1_TITLES: string[] = [
  // Already ingested — included so the curated output is the complete tier 1
  'Privacy Act 1988',
  'Fair Work Act 2009',
  'Corporations Act 2001',
  'Acts Interpretation Act 1901',
  'Australian Information Commissioner Act 2010',

  // Procedural
  'Evidence Act 1995',
  'Federal Court of Australia Act 1976',
  'Judiciary Act 1903',

  // Substantive commercial
  'Competition and Consumer Act 2010',
  'Bankruptcy Act 1966',
  'Personal Property Securities Act 2009',
  'Insurance Contracts Act 1984',
  'Trade Marks Act 1995',
  'Patents Act 1990',
  'Copyright Act 1968',
  'Designs Act 2003',
  'Australian Securities and Investments Commission Act 2001',
  'Banking Act 1959',

  // Financial / tax
  'Income Tax Assessment Act 1997',
  'Income Tax Assessment Act 1936',
  'Taxation Administration Act 1953',
  'A New Tax System (Goods and Services Tax) Act 1999',

  // Financial regulation
  'Superannuation Industry (Supervision) Act 1993',
  'Anti-Money Laundering and Counter-Terrorism Financing Act 2006',
  'Foreign Acquisitions and Takeovers Act 1975',

  // High-volume specialist
  'Migration Act 1958',
  'Family Law Act 1975',
  'Native Title Act 1993',
  'Therapeutic Goods Act 1989',

  // Cross-cutting
  'Crimes Act 1914',
  'Proceeds of Crime Act 2002',
  'Customs Act 1901',
  'Marriage Act 1961',
];

// =============================================================================
// CSV parsing — same minimal parser as probe-cth-acts.ts
// =============================================================================

function parseCsv(text: string): Record<string, string>[] {
  const normalized = text.replace(/\r\n/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];

    if (inQuotes) {
      if (c === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) return [];

  const headers = rows[0];
  const out: Record<string, string>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.length === 1 && r[0] === '') continue;
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = r[j] ?? '';
    }
    out.push(obj);
  }
  return out;
}

function csvEscape(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// =============================================================================
// Matching logic
// =============================================================================

type Match =
  | { kind: 'exact'; tier1: string; row: Record<string, string> }
  | {
      kind: 'fuzzy';
      tier1: string;
      row: Record<string, string>;
      alternatives: Record<string, string>[];
    }
  | { kind: 'none'; tier1: string };

function matchTier1(
  tier1Title: string,
  allActs: Record<string, string>[],
): Match {
  const needle = tier1Title.trim().toLowerCase();

  // Pass 1: exact title match.
  const exacts = allActs.filter((r) => r.title.trim().toLowerCase() === needle);
  if (exacts.length === 1) {
    return { kind: 'exact', tier1: tier1Title, row: exacts[0] };
  }
  if (exacts.length > 1) {
    // Should be impossible (registration IDs unique) but defensive:
    return { kind: 'fuzzy', tier1: tier1Title, row: exacts[0], alternatives: exacts };
  }

  // Pass 2: contains match — title contains the entire tier-1 string.
  const contains = allActs.filter((r) =>
    r.title.toLowerCase().includes(needle),
  );
  if (contains.length === 0) {
    return { kind: 'none', tier1: tier1Title };
  }
  if (contains.length === 1) {
    return { kind: 'fuzzy', tier1: tier1Title, row: contains[0], alternatives: [] };
  }

  // Multiple fuzzy matches — pick the first but flag for review.
  return {
    kind: 'fuzzy',
    tier1: tier1Title,
    row: contains[0],
    alternatives: contains.slice(1),
  };
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.error(`[filter] reading ${INPUT_CSV}`);
  const inputText = await readFile(INPUT_CSV, 'utf8');
  const allActs = parseCsv(inputText);
  console.error(`[filter] ${allActs.length} total Acts in input`);
  console.error(`[filter] ${TIER_1_TITLES.length} tier-1 titles to match`);
  console.error('');

  const matches: Match[] = TIER_1_TITLES.map((t) => matchTier1(t, allActs));

  // Report matches.
  const exacts = matches.filter((m) => m.kind === 'exact');
  // Type predicate so we get the right narrowed shape after .filter()
  // without using Extract<> which trips up tsx at runtime.
  function isFuzzy(
    m: Match,
  ): m is { kind: 'fuzzy'; tier1: string; row: Record<string, string>; alternatives: Record<string, string>[] } {
    return m.kind === 'fuzzy';
  }
  const fuzzies = matches.filter(isFuzzy);
  const misses = matches.filter((m) => m.kind === 'none');

  console.error(`[filter] exact matches: ${exacts.length}`);
  console.error(`[filter] fuzzy matches: ${fuzzies.length}`);
  console.error(`[filter] no match:      ${misses.length}`);
  console.error('');

  if (fuzzies.length > 0) {
    console.error(`[filter] === FUZZY MATCHES (REVIEW THESE) ===`);
    for (const m of fuzzies) {
      console.error(`  Looking for: "${m.tier1}"`);
      console.error(`  Matched:     "${m.row.title}" (${m.row.registration_id})`);
      if (m.alternatives.length > 0) {
        console.error(`  Other candidates (NOT selected):`);
        for (const alt of m.alternatives) {
          console.error(`    - "${alt.title}" (${alt.registration_id})`);
        }
      }
      console.error('');
    }
  }

  if (misses.length > 0) {
    console.error(`[filter] === UNMATCHED (FIX MANUALLY) ===`);
    for (const m of misses) {
      console.error(`  No match for: "${m.tier1}"`);
    }
    console.error('');
  }

  // Build output CSV — same shape as input, in tier-1 order.
  const headers = Object.keys(allActs[0] ?? {});
  if (headers.length === 0) {
    throw new Error(`Input CSV has no rows`);
  }

  const lines = [headers.join(',')];
  for (const m of matches) {
    if (m.kind === 'none') continue;
    const row = m.kind === 'exact' ? m.row : m.row;
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }

  await writeFile(OUTPUT_CSV, lines.join('\n') + '\n', 'utf8');

  const matchedCount = exacts.length + fuzzies.length;
  console.error(
    `[filter] wrote ${matchedCount} matched Acts (of ${TIER_1_TITLES.length} requested) to:`,
  );
  console.error(`         ${OUTPUT_CSV}`);

  if (misses.length > 0) {
    console.error('');
    console.error(
      `[filter] WARNING: ${misses.length} tier-1 entries did not match any Act.`,
    );
    console.error(
      `         Either the title in tier-1 list is wrong, or the Act has a different ` +
        `official title in the Federal Register, or the Act is repealed/not in force.`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});