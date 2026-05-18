import { config } from 'dotenv';
config({ path: '.env.local' });
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { prepare: false });

async function main() {
  const rows = await sql`
    SELECT j.id, j.citation, j.case_name, j.paragraph_count
    FROM judgments j
    LEFT JOIN (
      SELECT DISTINCT judgment_id FROM judgment_embeddings
    ) e ON e.judgment_id = j.id
    WHERE e.judgment_id IS NULL
    ORDER BY j.paragraph_count ASC NULLS FIRST
    LIMIT 30
  `;

  console.log(`Found ${rows.length} unembedded judgments:`);
  for (const r of rows) {
    console.log(`  ${r.citation ?? '?'} — ${r.case_name ?? '(no name)'} — ${r.paragraph_count ?? 0} paras`);
  }

  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
