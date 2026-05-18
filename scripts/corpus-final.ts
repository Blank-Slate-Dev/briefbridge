import { config } from 'dotenv';
config({ path: '.env.local' });
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

async function main() {
  const [{ je }] = await sql`SELECT COUNT(*)::int AS je FROM judgment_embeddings`;
  const [{ jw }] = await sql`SELECT COUNT(*)::int AS jw FROM judgments`;
  const [{ embedded_judgments }] = await sql`
    SELECT COUNT(DISTINCT judgment_id)::int AS embedded_judgments
    FROM judgment_embeddings
  `;
  const remaining = jw - embedded_judgments;

  console.log(`Total paragraphs embedded:    ${je.toLocaleString()}`);
  console.log(`Judgments embedded:           ${embedded_judgments.toLocaleString()} of ${jw.toLocaleString()}`);
  console.log(`Remaining unembedded:         ${remaining}`);
  console.log(`Coverage:                     ${((embedded_judgments / jw) * 100).toFixed(2)}%`);

  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
