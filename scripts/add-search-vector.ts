// scripts/add-search-vector.ts
//
// Migration 0010 (run-once): adds the stored, generated `search_vector`
// tsvector column to `judgments` and swaps the GIN index onto it.
//
// WHY A SCRIPT (not the Supabase dashboard SQL editor): the dashboard editor
// imposes an "upstream" gateway timeout that the multi-minute backfill of
// ~39k full judgment bodies exceeds, dropping the connection mid-operation.
//
// IMPORTANT — CONNECTION: run this against the DIRECT connection (port 5432,
// db.<ref>.supabase.co), NOT the transaction pooler (port 6543, *.pooler.
// supabase.com). The pooler is transaction-mode and won't reliably honour the
// session-level `SET statement_timeout`, so the backfill would time out. Set
// the direct URL in the shell before running (it overrides .env.local because
// dotenv does not override already-set env vars):
//
//   $env:DATABASE_URL = "postgresql://postgres:<pwd>@db.<ref>.supabase.co:5432/postgres"
//   npx tsx scripts/add-search-vector.ts
//
// SAFE TO RE-RUN: uses IF NOT EXISTS / IF EXISTS, so a second run is a no-op
// if the column/index already exist.

import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db } from '../lib/db';

async function main() {
  const started = Date.now();

  // Show which host we're connected to so a pooler mistake is obvious.
  const url = process.env.DATABASE_URL ?? '';
  const hostMatch = url.match(/@([^/:]+):(\d+)/);
  const host = hostMatch ? `${hostMatch[1]}:${hostMatch[2]}` : '(unparsed)';
  console.log(`Migration 0010 — connecting to ${host}`);
  if (host.includes('pooler') || host.endsWith(':6543')) {
    console.warn(
      '  ⚠ This looks like the TRANSACTION POOLER. The backfill may time out.\n' +
        '    Set $env:DATABASE_URL to the DIRECT connection (db.<ref>.supabase.co:5432) and re-run.',
    );
  }

  console.log('  • raising statement_timeout to 30min for this session');
  await db.execute(sql`SET statement_timeout = '1800000'`); // 30 min (ms)

  console.log(
    '  • adding generated column search_vector (slow — backfilling ~39k full-text rows) …',
  );
  await db.execute(sql`
    ALTER TABLE judgments
      ADD COLUMN IF NOT EXISTS search_vector tsvector
      GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(case_name, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(citation, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(catchwords, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(full_text, '')), 'C')
      ) STORED
  `);
  console.log(
    `    column added (${((Date.now() - started) / 1000).toFixed(0)}s elapsed)`,
  );

  console.log('  • rebuilding GIN index on the column …');
  await db.execute(sql`DROP INDEX IF EXISTS judgments_search_vector_idx`);
  await db.execute(
    sql`CREATE INDEX judgments_search_vector_idx ON judgments USING gin (search_vector)`,
  );
  console.log('    index rebuilt');

  const result = await db.execute(sql`
    SELECT count(*)::int AS total, count(search_vector)::int AS populated FROM judgments
  `);
  // postgres-js returns an array-like of rows.
  const row = (Array.isArray(result) ? result[0] : undefined) as
    | { total: number; populated: number }
    | undefined;
  if (row) {
    console.log(`  • verify: ${row.populated} of ${row.total} rows populated`);
    if (row.populated !== row.total) {
      console.warn('    ⚠ populated != total — investigate before deploying code.');
    }
  } else {
    console.log('  • verify: completed (could not parse count result shape; non-fatal).');
  }

  console.log(`Done in ${((Date.now() - started) / 1000).toFixed(0)}s.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});