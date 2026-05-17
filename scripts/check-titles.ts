import { config } from 'dotenv';
config({ path: '.env.local' });
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

async function main() {
  const rows = await sql`
    SELECT registration_id, short_title, compilation_date
    FROM legislation
    WHERE jurisdiction = 'commonwealth'
    ORDER BY short_title
  `;
  for (const r of rows) {
    console.log(`  ${r.registration_id}  "${r.short_title}"  @${r.compilation_date}`);
  }
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
