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
  const [{ le }] = await sql`SELECT COUNT(*)::int AS le FROM legislation_section_embeddings`;
  const [{ ls }] = await sql`SELECT COUNT(*)::int AS ls FROM legislation_sections WHERE level IN ('section','schedule_clause') AND text != ''`;

  console.log(`\n=== Caselaw ===`);
  console.log(`Judgment paragraphs embedded:   ${je.toLocaleString()}`);
  console.log(`Distinct judgments with embeds: ${embedded_judgments.toLocaleString()} of ${jw.toLocaleString()}`);

  console.log(`\n=== Legislation ===`);
  console.log(`Section embeddings:             ${le.toLocaleString()}`);
  console.log(`Expected leaf rows:             ${ls.toLocaleString()}`);

  console.log(`\n=== Combined retrieval surface ===`);
  console.log(`Total searchable embeddings:    ${(je + le).toLocaleString()}`);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
