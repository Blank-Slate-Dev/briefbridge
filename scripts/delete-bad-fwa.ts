import { config } from 'dotenv';
config({ path: '.env.local' });
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

async function main() {
  // Delete the current Fair Work row (truncated to 578 sections from
  // document_1 only). CASCADE removes its 578 sections too.
  const result = await sql`
    DELETE FROM legislation
    WHERE registration_id = 'C2009A00028'
      AND jurisdiction = 'commonwealth'
    RETURNING id, short_title
  `;
  console.log(`Deleted ${result.length} Fair Work row(s):`, result);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
