// scripts/diag-embed.ts — one-off: what does the EMBED SCRIPT's db connection see?
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db, schema } from '../lib/db/script-db';

async function main() {
  // 1. How many judgments can THIS connection see?
  const totalJudgments = await db.select({ c: sql<number>`count(*)::int` }).from(schema.judgments);
  console.log('judgments visible to script:', totalJudgments[0].c);

  // 2. How many embedding rows can it see?
  const totalEmb = await db.select({ c: sql<number>`count(*)::int` }).from(schema.judgmentEmbeddings);
  console.log('judgment_embeddings visible to script:', totalEmb[0].c);

  // 3. Which DB role / database is this?
  const who = await db.execute(sql`select current_user, current_database()`);
  console.log('connection identity:', JSON.stringify(who));

  // 4. The exact "needs embedding" count via raw SQL on THIS connection
  const needs = await db.execute(sql`
    select count(*)::int as c
    from judgments j
    where not exists (
      select 1 from judgment_embeddings e
      where e.judgment_id = j.id and e.model = 'voyage-law-2'
    )
  `);
  console.log('needs-embedding (raw, this connection):', JSON.stringify(needs));

  process.exit(0);
}
main().catch((e) => {
  console.error('MESSAGE:', e?.message);
  console.error('CODE:', e?.code);
  console.error('DETAIL:', e?.detail);
  console.error('SEVERITY:', e?.severity);
  console.error('CAUSE:', e?.cause?.message ?? e?.cause);
  process.exit(1);
});