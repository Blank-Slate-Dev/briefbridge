import { config } from 'dotenv';
config({ path: '.env.local' });
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

async function main() {
  const rows = await sql`
    SELECT level, count(*) as n
    FROM legislation_sections
    WHERE legislation_id = 'cc93c1e4-b9fc-447e-a3a8-cabb9a7edf9c'
    GROUP BY level
    ORDER BY n DESC
  `;
  console.log('--- AIA 1901 LEVEL COUNTS ---');
  console.table(rows);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
