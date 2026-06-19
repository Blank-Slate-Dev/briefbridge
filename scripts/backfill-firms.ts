// scripts/backfill-firms.ts
//
// SLICE 1 backfill: give every existing user a personal firm-of-one, and
// stamp every existing matter with its creator's firm_id.
//
// After this runs:
//   - Each distinct user_id that owns matters (or has a profile) gets ONE
//     `firms` row (name: "<their> firm" placeholder) + ONE firm_memberships
//     row as 'owner'.
//   - Each existing matter gets firm_id = its creator's personal firm.
//   - The app behaves IDENTICALLY to before (everyone is alone in their firm).
//
// SAFETY:
//   - DRY RUN BY DEFAULT. Running with no flag only READS and PRINTS what it
//     would do. It writes NOTHING. Inspect the output, then re-run with
//     --commit to actually write.
//   - Idempotent: skips users who already have a membership, and matters that
//     already have firm_id set. Safe to re-run.
//
// RUN:
//   Dry run (default, writes nothing):
//     $env:DATABASE_URL="<conn>"; npx tsx scripts/backfill-firms.ts
//   Real run (writes):
//     $env:DATABASE_URL="<conn>"; npx tsx scripts/backfill-firms.ts --commit

import 'dotenv/config';
import { db } from '../lib/db';
import { sql } from 'drizzle-orm';

const COMMIT = process.argv.includes('--commit');

async function main() {
  console.log('');
  console.log('=== Backfill: firms + memberships + matters.firm_id ===');
  console.log(COMMIT ? '*** COMMIT MODE — will write to the database ***' : '--- DRY RUN — no writes, inspection only ---');
  console.log('');

  // --------------------------------------------------------------------------
  // 1. Find every distinct user who needs a personal firm.
  //
  // A user "needs" a firm if they own at least one matter OR have a profile
  // row. We union both sources so we don't miss a user who signed up but
  // hasn't created a matter yet.
  // --------------------------------------------------------------------------
  const usersResult = await db.execute(sql`
    SELECT DISTINCT u.user_id
    FROM (
      SELECT user_id FROM matters
      UNION
      SELECT id AS user_id FROM profiles
    ) AS u
    WHERE u.user_id IS NOT NULL
  `);

  // postgres-js returns rows on .rows (array). Normalise.
  const userRows = (usersResult as unknown as { rows?: Array<{ user_id: string }> }).rows
    ?? (usersResult as unknown as Array<{ user_id: string }>);

  const userIds = userRows.map((r) => r.user_id);
  console.log(`Found ${userIds.length} distinct user(s) who need a personal firm.`);

  // --------------------------------------------------------------------------
  // 2. For each user: check if they already have a membership (idempotency).
  //    If not, create firm + owner membership.
  // --------------------------------------------------------------------------
  let firmsToCreate = 0;
  let firmsSkipped = 0;

  for (const userId of userIds) {
    const existing = await db.execute(sql`
      SELECT 1 FROM firm_memberships WHERE user_id = ${userId} LIMIT 1
    `);
    const existingRows = (existing as unknown as { rows?: unknown[] }).rows
      ?? (existing as unknown as unknown[]);

    if (existingRows.length > 0) {
      firmsSkipped += 1;
      continue;
    }

    firmsToCreate += 1;

    if (COMMIT) {
      // Create the firm, then the owner membership pointing at it.
      const firmInsert = await db.execute(sql`
        INSERT INTO firms (name, plan, seats)
        VALUES ('My Firm', 'trial', 1)
        RETURNING id
      `);
      const firmRows = (firmInsert as unknown as { rows?: Array<{ id: string }> }).rows
        ?? (firmInsert as unknown as Array<{ id: string }>);
      const firmId = firmRows[0].id;

      await db.execute(sql`
        INSERT INTO firm_memberships (firm_id, user_id, role)
        VALUES (${firmId}, ${userId}, 'owner')
      `);

      // Stamp this user's matters with the new firm_id (only those still null).
      await db.execute(sql`
        UPDATE matters
        SET firm_id = ${firmId}
        WHERE user_id = ${userId} AND firm_id IS NULL
      `);

      console.log(`  [committed] user ${userId.slice(0, 8)}… → firm ${firmId.slice(0, 8)}…`);
    } else {
      // Dry run: just report what we'd do, and how many matters we'd stamp.
      const matterCount = await db.execute(sql`
        SELECT count(*)::int AS n FROM matters
        WHERE user_id = ${userId} AND firm_id IS NULL
      `);
      const mcRows = (matterCount as unknown as { rows?: Array<{ n: number }> }).rows
        ?? (matterCount as unknown as Array<{ n: number }>);
      const n = mcRows[0]?.n ?? 0;
      console.log(`  [would create] firm for user ${userId.slice(0, 8)}… and stamp ${n} matter(s)`);
    }
  }

  console.log('');
  console.log(`Summary: ${firmsToCreate} firm(s) ${COMMIT ? 'created' : 'would be created'}, ${firmsSkipped} user(s) already had a firm (skipped).`);

  // --------------------------------------------------------------------------
  // 3. Final check: any matters STILL without a firm_id?
  //    (Should be zero after a commit run. In dry run, shows the current gap.)
  // --------------------------------------------------------------------------
  const orphanCheck = await db.execute(sql`
    SELECT count(*)::int AS n FROM matters WHERE firm_id IS NULL
  `);
  const orphanRows = (orphanCheck as unknown as { rows?: Array<{ n: number }> }).rows
    ?? (orphanCheck as unknown as Array<{ n: number }>);
  const orphans = orphanRows[0]?.n ?? 0;
  console.log(`Matters still without firm_id: ${orphans}${COMMIT ? ' (should be 0)' : ' (will be 0 after --commit)'}`);

  console.log('');
  console.log(COMMIT ? '=== Done (committed) ===' : '=== Dry run complete — re-run with --commit to write ===');
  console.log('');

  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});