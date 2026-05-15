import { config } from 'dotenv';
config({ path: '.env.local' });
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

async function main() {
  // Show the very first 30 rows so we can see what the parser produced at the top
  const head = await sql`
    SELECT sort_order, level, number, heading, length(text) AS text_len
    FROM legislation_sections
    WHERE legislation_id = '921eb86d-1336-401b-a4c7-c2c0322340ca'
    ORDER BY sort_order
    LIMIT 30
  `;
  console.log('--- FIRST 30 ROWS ---');
  console.table(head);

  // Show count by level (we have this from the ingest output, but confirms persistence)
  const levels = await sql`
    SELECT level, count(*)::int AS n
    FROM legislation_sections
    WHERE legislation_id = '921eb86d-1336-401b-a4c7-c2c0322340ca'
    GROUP BY level
    ORDER BY n DESC
  `;
  console.log('--- LEVELS ---');
  console.table(levels);

  // Show the boundary — find where the parser switched into schedule mode
  // (first schedule row), and what came before it
  const firstSchedule = await sql`
    SELECT sort_order, level, number, heading
    FROM legislation_sections
    WHERE legislation_id = '921eb86d-1336-401b-a4c7-c2c0322340ca'
      AND level = 'schedule'
    ORDER BY sort_order
    LIMIT 5
  `;
  console.log('--- SCHEDULE ROWS ---');
  console.table(firstSchedule);

  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
