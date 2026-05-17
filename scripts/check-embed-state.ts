import { config } from 'dotenv';
config({ path: '.env.local' });
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

async function main() {
  // 1. Does the embeddings table exist?
  const tableExists = await sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'legislation_section_embeddings'
  `;
  console.log(`embeddings table exists: ${tableExists.length === 1}`);

  if (tableExists.length === 1) {
    const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM legislation_section_embeddings`;
    console.log(`existing embedding rows: ${count}`);
  }

  // 2. How many sections, and how many are leaf+content (the embedding target)?
  const [{ total }] = await sql`SELECT COUNT(*)::int AS total FROM legislation_sections`;
  const [{ leaves }] = await sql`
    SELECT COUNT(*)::int AS leaves FROM legislation_sections
    WHERE level IN ('section', 'schedule_clause')
      AND text != ''
  `;
  const [{ embedded, unembedded }] = await sql`
    SELECT
      COUNT(embedded_at)::int AS embedded,
      (COUNT(*) - COUNT(embedded_at))::int AS unembedded
    FROM legislation_sections
  `;
  console.log(`total sections:                       ${total}`);
  console.log(`embedding target (leaves with text):  ${leaves}`);
  console.log(`sections w/ embedded_at set:          ${embedded}`);
  console.log(`sections needing embedding:           ${unembedded}`);

  // 3. Distribution of section text lengths — informs the "monster section" handling
  const longest = await sql`
    SELECT citation, LENGTH(text) AS chars
    FROM legislation_sections
    WHERE level IN ('section', 'schedule_clause')
    ORDER BY LENGTH(text) DESC
    LIMIT 10
  `;
  console.log(`\nTop 10 longest sections by char count:`);
  for (const r of longest) {
    console.log(`  ${r.chars.toString().padStart(8)}  ${r.citation}`);
  }

  // Count sections over ~50K chars (≈14K tokens, our truncation threshold)
  const [{ monsters }] = await sql`
    SELECT COUNT(*)::int AS monsters
    FROM legislation_sections
    WHERE level IN ('section', 'schedule_clause')
      AND LENGTH(text) > 50000
  `;
  console.log(`\nMonster sections (>50K chars, will truncate): ${monsters}`);

  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
