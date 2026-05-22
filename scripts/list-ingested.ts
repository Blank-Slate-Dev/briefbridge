import { config } from 'dotenv';
config({ path: '.env.local' });
import postgres from 'postgres';
const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
const rows = await sql`SELECT registration_id, short_title, compilation_date FROM legislation WHERE jurisdiction='commonwealth'`;
for (const r of rows) console.log(`${r.registration_id} | ${r.compilation_date} | ${r.short_title}`);
await sql.end();
