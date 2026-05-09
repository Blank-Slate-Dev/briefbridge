// scripts/count-embeddings.ts
import { db } from '../lib/db';
import { sql } from 'drizzle-orm';

async function main() {
  const result = await db.execute(sql`
    SELECT 
      COUNT(*) AS paragraphs,
      COUNT(DISTINCT judgment_id) AS cases,
      MAX(created_at) AS last_insert
    FROM judgment_embeddings
  `);
  console.log(result);
  process.exit(0);
}

main();