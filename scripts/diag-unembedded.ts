import { config } from 'dotenv';
config({ path: '.env.local' });
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

async function main() {
  const rows = await sql`
    SELECT 
      j.id, 
      j.citation, 
      j.paragraph_count,
      jsonb_array_length(j.paragraphs) AS jsonb_length,
      LENGTH(j.full_text) AS full_text_len
    FROM judgments j
    LEFT JOIN (
      SELECT DISTINCT judgment_id FROM judgment_embeddings
    ) e ON e.judgment_id = j.id
    WHERE e.judgment_id IS NULL
    ORDER BY j.paragraph_count DESC NULLS LAST
    LIMIT 30
  `;

  console.log(`citation | paragraph_count | jsonb_array_length | full_text_len`);
  console.log(`---`);
  for (const r of rows) {
    console.log(`${r.citation} | ${r.paragraph_count ?? 'NULL'} | ${r.jsonb_length ?? 'NULL'} | ${r.full_text_len ?? 'NULL'}`);
  }

  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
