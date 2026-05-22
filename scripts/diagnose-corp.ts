// scripts/diagnose-corp.ts
//
// Compares parser output against DB content around the drift point
// for Corporations Act. Read-only — no DB writes, no embeddings.
//
// Usage: npx tsx scripts/diagnose-corp.ts

import { config } from 'dotenv';
config({ path: '.env.local' });
import postgres from 'postgres';
import { parseLegislationHtml } from '@/lib/legislation/parser';
import { buildActCitation } from '@/lib/legislation/citations';
import { fetchActHtml } from '@/lib/legislation/fetch';

const REG_ID = 'C2004A00818';
const COMP_DATE = '2025-12-19';
const DRIFT_START = 5250;
const DRIFT_END = 5300;

interface DbRow {
  sort_order: number;
  level: string;
  number: string;
  heading: string | null;
}

async function main() {
  // 1. Fetch and parse
  console.log(`[diag] fetching ${REG_ID} @ ${COMP_DATE}`);
  const fetchResult = await fetchActHtml(REG_ID, COMP_DATE);
  console.log(
    `[diag] fetched ${fetchResult.documents.length} doc(s), ` +
      `${fetchResult.html.length.toLocaleString()} bytes`,
  );

  const actCitation = buildActCitation('Corporations Act 2001', 'commonwealth');
  const parsed = parseLegislationHtml(fetchResult.html, {
    actCitation,
    jurisdiction: 'commonwealth',
  });
  console.log(`[diag] parser produced ${parsed.sections.length} sections\n`);

  // 2. Get DB sections in drift range
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }
  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  const dbRowsRaw = await sql`
    SELECT sort_order, level, number, heading
    FROM legislation_sections
    WHERE legislation_id = (
      SELECT id FROM legislation
      WHERE registration_id = ${REG_ID} AND jurisdiction = 'commonwealth'
    )
      AND sort_order BETWEEN ${DRIFT_START} AND ${DRIFT_END}
    ORDER BY sort_order
  `;
  await sql.end();

  const dbRows: DbRow[] = dbRowsRaw.map((r) => ({
    sort_order: Number(r.sort_order),
    level: String(r.level),
    number: String(r.number),
    heading: r.heading == null ? null : String(r.heading),
  }));

  // 3. Compare side by side
  console.log(`=== Side-by-side: DB vs Parser (sort_order ${DRIFT_START}-${DRIFT_END}) ===\n`);
  console.log(`idx    | DB                                            | Parser`);
  console.log('-'.repeat(110));

  for (let i = DRIFT_START; i <= DRIFT_END; i++) {
    const dbRow = dbRows.find((r) => r.sort_order === i);
    const parserRow = parsed.sections[i];

    const dbStr = dbRow
      ? `${dbRow.level} ${dbRow.number}${dbRow.heading ? ' — ' + dbRow.heading.slice(0, 30) : ''}`
      : '(none)';

    const parserStr = parserRow
      ? `${parserRow.level} ${parserRow.number}${parserRow.heading ? ' — ' + parserRow.heading.slice(0, 30) : ''}`
      : '(none)';

    const marker = dbStr === parserStr ? ' ' : '*';
    console.log(
      `${marker} ${i.toString().padEnd(5)} | ${dbStr.padEnd(45)} | ${parserStr}`,
    );
  }

  console.log(`\n* = mismatch`);

  // 4. Parser warnings during this run
  console.log(`\n=== Parser warnings (this re-parse) ===`);
  if (parsed.warnings.length === 0) {
    console.log('  (none)');
  } else {
    for (const w of parsed.warnings.slice(0, 20)) {
      console.log(`  - ${w}`);
    }
    if (parsed.warnings.length > 20) {
      console.log(`  ... and ${parsed.warnings.length - 20} more`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});