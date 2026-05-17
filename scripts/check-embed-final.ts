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
  const [{ total_leaves }] = await sql`
    SELECT COUNT(*)::int AS total_leaves FROM legislation_sections
    WHERE level IN ('section', 'schedule_clause')
      AND text != ''
  `;

  console.log(`legislation_section_embeddings rows:        ${embeddings}`);
  console.log(`legislation_sections with embedded_at set:  ${flagged}`);
  console.log(`expected leaves (level=section|sch_clause): ${total_leaves}`);

  // Per-Act breakdown
  console.log(`\nPer-Act embedding counts:`);
  const perAct = await sql`
    SELECT
      l.short_title,
      COUNT(e.section_id)::int AS embedded,
      COUNT(s.id)::int AS total_leaves
    FROM legislation l
    JOIN legislation_sections s ON s.legislation_id = l.id
      AND s.level IN ('section', 'schedule_clause')
      AND s.text != ''
    LEFT JOIN legislation_section_embeddings e ON e.section_id = s.id
    WHERE l.jurisdiction = 'commonwealth'
    GROUP BY l.short_title
    ORDER BY total_leaves DESC
  `;
  for (const r of perAct) {
    const tag = r.embedded === r.total_leaves ? '✓' : '✗';
    console.log(`  ${tag} ${r.short_title}: ${r.embedded}/${r.total_leaves}`);
  }

  // Distribution check
  const [{ min_dim, max_dim }] = await sql`
    SELECT
      MIN(array_length(embedding::real[], 1))::int AS min_dim,
      MAX(array_length(embedding::real[], 1))::int AS max_dim
    FROM legislation_section_embeddings
  `;
  console.log(`\nEmbedding dimensions: min=${min_dim} max=${max_dim} (expected 1024 both)`);

  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
