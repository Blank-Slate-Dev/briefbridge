// scripts/diag-latency.ts
//
// Measures round-trip latency to the database and times the exact query
// chain the (app) layout runs on every navigation. Run from the SAME
// machine you develop on.
//
//   npx tsx --env-file=.env.local scripts/diag-latency.ts

import { sql } from 'drizzle-orm';
import { db } from '../lib/db/script-db';

async function time<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await fn();
  const ms = (performance.now() - start).toFixed(0);
  console.log(`  ${label.padEnd(46)} ${ms.padStart(6)} ms`);
  return result;
}

async function main() {
  console.log('\n--- Raw round-trip (SELECT 1, five runs) ---');
  for (let i = 1; i <= 5; i++) {
    await time(`select 1 (run ${i})`, () => db.execute(sql`select 1`));
  }

  console.log('\n--- Representative layout-style queries ---');
  await time('count matters (single-table)', () =>
    db.execute(sql`select count(*) from matters`),
  );
  await time('recent conversations (order+limit)', () =>
    db.execute(sql`select id from conversations order by updated_at desc limit 5`),
  );
  await time('firm memberships (join-ish)', () =>
    db.execute(sql`select count(*) from firm_memberships`),
  );

  console.log('\n--- Legislation page chain (serial, as the page runs it) ---');
  const act = await time('getActBySlug-equivalent', () =>
    db.execute(sql`
      select id from legislation
      where jurisdiction = 'nsw' and in_force = true
        and lower(regexp_replace(short_title, '[^a-zA-Z0-9]+', '-', 'g')) = 'civil-liability-act-2002'
      limit 1
    `),
  );
  const actId = (act as unknown as Array<{ id: string }>)[0]?.id;
  if (actId) {
    await time('getSection-equivalent', () =>
      db.execute(sql`
        select id from legislation_sections
        where legislation_id = ${actId}::uuid and level = 'section'
          and lower(number) = '5o' limit 1
      `),
    );
    await time('listActSections-equivalent (TOC)', () =>
      db.execute(sql`
        select number, heading from legislation_sections
        where legislation_id = ${actId}::uuid and level = 'section'
          and text != '' and number ~ '^[A-Za-z0-9.]+$'
        order by sort_order
      `),
    );
  }

  console.log('\nInterpretation:');
  console.log('  select-1 ≈ pure network round trip to the DB region.');
  console.log('  If it is ~100ms+, geography dominates and every serial');
  console.log('  query wave costs that much again. 4-6 waves per page load');
  console.log('  = the slowness you feel.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });