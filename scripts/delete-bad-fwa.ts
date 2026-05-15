import { config } from 'dotenv';
config({ path: '.env.local' });
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

async function main() {
  const result = await sql`
    DELETE FROM legislation
    WHERE id = '921eb86d-1336-401b-a4c7-c2c0322340ca'
    RETURNING short_title
  `;
  console.log(`Deleted ${result.length} legislation row(s):`, result);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
