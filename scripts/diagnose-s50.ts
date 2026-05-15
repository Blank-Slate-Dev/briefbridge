import { config } from 'dotenv';
config({ path: '.env.local' });
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

async function main() {
  // Check for multiple Privacy Act rows (suggests duplicate ingest)
  const acts = await sql`
    SELECT id, short_title, compilation_date, created_at, updated_at
    FROM legislation
    WHERE jurisdiction = 'commonwealth'
      AND short_title ILIKE '%Privacy Act 1988%'
    ORDER BY created_at
  `;
  console.log('--- PRIVACY ACT ROWS IN legislation ---');
  console.table(acts);

  // Get s 50 directly
  const sections = await sql`
    SELECT s.id, s.number, s.heading, s.legislation_id, length(s.text) AS text_length
    FROM legislation_sections s
    JOIN legislation l ON l.id = s.legislation_id
    WHERE l.short_title ILIKE '%Privacy Act 1988%'
      AND s.level = 'section'
      AND s.number = '50'
    ORDER BY s.legislation_id
  `;
  console.log('--- s 50 ROWS ---');
  console.table(sections);

  // Show the actual stored text for s 50
  const fullText = await sql`
    SELECT s.text
    FROM legislation_sections s
    JOIN legislation l ON l.id = s.legislation_id
    WHERE l.short_title ILIKE '%Privacy Act 1988%'
      AND s.level = 'section'
      AND s.number = '50'
  `;
  console.log('--- STORED TEXT FOR s 50 ---');
  for (const row of fullText) {
    console.log('=== ROW ===');
    console.log(row.text);
    console.log('=== END ROW ===');
  }

  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
