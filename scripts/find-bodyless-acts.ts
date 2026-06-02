// scripts/find-bodyless-acts.ts
//
// Flags any ingested Act with ZERO 'section'-level rows — the signature of the
// flat-section parse bug (PRE_BODY never transitioned to BODY, so the Act's
// body sections were skipped and only its schedules survived).
//
// A hit is NOT automatically a bug: a few Acts are genuinely schedule-only
// (pure amending Acts, etc.). Triage the list by hand — anything that should
// have an operative body gets a re-ingest with the fixed parser.

import { config } from 'dotenv';
config({ path: '.env.local' });
import postgres from 'postgres';

async function main(): Promise<void> {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  try {
    const rows = await sql`
      SELECT l.registration_id, l.short_title, l.jurisdiction,
             COUNT(*) FILTER (WHERE s.level = 'section')         AS body_sections,
             COUNT(*) FILTER (WHERE s.level = 'schedule_clause') AS sched_clauses,
             COUNT(*)                                            AS total_rows
      FROM legislation l
      LEFT JOIN legislation_sections s ON s.legislation_id = l.id
      GROUP BY l.id, l.registration_id, l.short_title, l.jurisdiction
      HAVING COUNT(*) FILTER (WHERE s.level = 'section') = 0
      ORDER BY l.jurisdiction, l.short_title;
    `;
    if (rows.length === 0) {
      console.log('No bodyless Acts — every Act has at least one section-level row.');
    } else {
      console.log(`${rows.length} Act(s) with ZERO body sections (suspect — triage each):`);
      for (const r of rows) {
        console.log(
          `  ${r.registration_id} | ${r.jurisdiction} | ${r.short_title} ` +
            `| body=${r.body_sections} sched_cl=${r.sched_clauses} total=${r.total_rows}`,
        );
      }
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});