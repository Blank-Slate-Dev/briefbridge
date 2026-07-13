// scripts/diag-legislation-ranking.ts
//
// Diagnoses legislation retrieval ranking for a given query. Answers:
//   1. What similarity do SPECIFIC target sections (CLA ss 5O/5P/5B) score?
//   2. What are the top 20 legislation hits and their scores?
//
// This tells us whether the 0.45 minSimilarity threshold in
// lib/search/semantic-legislation.ts is cutting the right sections, and
// whether the embedded_text for those sections matches queries poorly.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/diag-legislation-ranking.ts
//   npx tsx --env-file=.env.local scripts/diag-legislation-ranking.ts --query "peer professional opinion"

import { sql } from 'drizzle-orm';
import { db } from '../lib/db/script-db';
import { embed } from '../lib/embeddings/voyage';

const DEFAULT_QUERY =
  'What is the standard of care for medical professionals in NSW, and how does the peer professional opinion defence operate?';

async function main() {
  const argv = process.argv.slice(2);
  const qIdx = argv.indexOf('--query');
  const query = qIdx >= 0 && argv[qIdx + 1] ? argv[qIdx + 1] : DEFAULT_QUERY;

  console.log(`Query: "${query}"\n`);

  const { embeddings } = await embed({
    texts: [query],
    model: 'voyage-law-2',
    inputType: 'query',
  });
  const vec = `[${embeddings[0].join(',')}]`;

  // 1. Scores for the specific target sections.
  const targets = await db.execute<{
    citation: string;
    similarity: number;
    embedded_text_preview: string;
  }>(sql`
    SELECT
      s.citation,
      1 - (e.embedding <=> ${vec}::vector) AS similarity,
      left(e.embedded_text, 120) AS embedded_text_preview
    FROM legislation_section_embeddings e
    JOIN legislation_sections s ON s.id = e.section_id
    JOIN legislation l ON l.id = s.legislation_id
    WHERE l.short_title = 'Civil Liability Act 2002'
      AND s.number IN ('5O', '5P', '5B')
    ORDER BY similarity DESC
  `);
  console.log('--- TARGET SECTIONS (CLA ss 5O/5P/5B) ---');
  for (const t of targets) {
    console.log(`  ${(t.similarity * 100).toFixed(1)}%  ${t.citation}`);
    console.log(`         embedded_text: ${t.embedded_text_preview}...`);
  }

  // 2. Top 20 legislation hits overall.
  const top = await db.execute<{
    citation: string;
    similarity: number;
  }>(sql`
    SELECT
      s.citation,
      1 - (e.embedding <=> ${vec}::vector) AS similarity
    FROM legislation_section_embeddings e
    JOIN legislation_sections s ON s.id = e.section_id
    ORDER BY e.embedding <=> ${vec}::vector
    LIMIT 20
  `);
  console.log('\n--- TOP 20 LEGISLATION HITS ---');
  top.forEach((t, i) =>
    console.log(`  ${String(i + 1).padStart(2)}. ${(t.similarity * 100).toFixed(1)}%  ${t.citation}`),
  );

  // 3. Same top-20 but with hnsw.ef_search raised — distinguishes "index
  // recall too low" (s 5O appears now) from "index broken" (still missing).
  await db.execute(sql`SET hnsw.ef_search = 400`);
  const topHighEf = await db.execute<{ citation: string; similarity: number }>(sql`
    SELECT
      s.citation,
      1 - (e.embedding <=> ${vec}::vector) AS similarity
    FROM legislation_section_embeddings e
    JOIN legislation_sections s ON s.id = e.section_id
    ORDER BY e.embedding <=> ${vec}::vector
    LIMIT 20
  `);
  await db.execute(sql`RESET hnsw.ef_search`);
  console.log('\n--- TOP 20 WITH ef_search = 400 ---');
  topHighEf.forEach((t, i) =>
    console.log(`  ${String(i + 1).padStart(2)}. ${(t.similarity * 100).toFixed(1)}%  ${t.citation}`),
  );

  console.log('\n(Threshold in semantic-legislation.ts: 0.45 = 45.0%)');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });