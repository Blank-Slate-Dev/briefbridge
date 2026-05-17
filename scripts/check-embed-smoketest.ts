import { config } from 'dotenv';
config({ path: '.env.local' });
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

async function main() {
  const [{ embeddings }] = await sql`
    SELECT COUNT(*)::int AS embeddings FROM legislation_section_embeddings
  `;
  const [{ flagged }] = await sql`
    SELECT COUNT(embedded_at)::int AS flagged FROM legislation_sections
  `;
  console.log(`embeddings rows: ${embeddings}`);
  console.log(`sections with embedded_at set: ${flagged}`);

  // Show a sample of the embedded_text to verify breadcrumb format
  console.log(`\nSample embedded_text values:`);
  const samples = await sql`
    SELECT
      LEFT(e.embedded_text, 200) AS preview,
      LENGTH(e.embedded_text) AS chars
    FROM legislation_section_embeddings e
    LIMIT 3
  `;
  for (const s of samples) {
    console.log(`\n  --- (${s.chars} chars) ---`);
    console.log(`  ${s.preview}...`);
  }

  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
