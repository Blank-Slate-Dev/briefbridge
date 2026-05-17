import { config } from 'dotenv';
config({ path: '.env.local' });
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

async function main() {
  const result = await sql`
    DELETE FROM legislation
    WHERE registration_id = 'C2004A00818'
      AND jurisdiction = 'commonwealth'
    RETURNING id, short_title
  `;
  console.log(`Deleted ${result.length} Corporations Act row(s):`, result);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
