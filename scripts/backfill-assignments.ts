// scripts/backfill-assignments.ts
//
// SLICE 2 backfill: assign every existing matter's CREATOR to it, so that
// when access queries flip from "userId ownership" to "assignment", every
// current user keeps access to their own matters.
//
// After this runs:
//   - Each matter gets ONE matter_assignments row: (matter_id, its user_id).
//   - assigned_by = the same user (they assigned themselves, effectively —
//     it's a migration backfill).
//
// SAFETY:
//   - DRY RUN BY DEFAULT. No flag = read + print only, writes nothing.
//     Inspect, then re-run with --commit.
//   - Idempotent: ON CONFLICT DO NOTHING on the composite PK, and the dry run
//     only counts matters not yet assigned to their creator. Safe to re-run.
//
// RUN:
//   Dry run:    $env:DATABASE_URL="<conn>"; npx tsx scripts/backfill-assignments.ts
//   Real run:   $env:DATABASE_URL="<conn>"; npx tsx scripts/backfill-assignments.ts --commit

import 'dotenv/config';
import { db } from '../lib/db';
import { sql } from 'drizzle-orm';

const COMMIT = process.argv.includes('--commit');

function rowsOf<T>(result: unknown): T[] {
  return (
    (result as { rows?: T[] }).rows ?? (result as T[])
  );
}

async function main() {
  console.log('');
  console.log('=== Backfill: matter_assignments (assign creators to their matters) ===');
  console.log(COMMIT ? '*** COMMIT MODE — will write ***' : '--- DRY RUN — no writes ---');
  console.log('');

  // How many matters do NOT yet have an assignment for their creator?
  const pending = await db.execute(sql`
    SELECT m.id, m.user_id
    FROM matters m
    WHERE NOT EXISTS (
      SELECT 1 FROM matter_assignments a
      WHERE a.matter_id = m.id AND a.user_id = m.user_id
    )
  `);
  const pendingRows = rowsOf<{ id: string; user_id: string }>(pending);

  console.log(`Matters needing a creator-assignment: ${pendingRows.length}`);

  if (!COMMIT) {
    for (const r of pendingRows) {
      console.log(`  [would assign] matter ${r.id.slice(0, 8)}… → user ${r.user_id.slice(0, 8)}…`);
    }
  } else {
    // Single set-based insert: assign each matter's creator. ON CONFLICT
    // DO NOTHING makes it idempotent against the composite PK.
    await db.execute(sql`
      INSERT INTO matter_assignments (matter_id, user_id, assigned_by)
      SELECT m.id, m.user_id, m.user_id
      FROM matters m
      ON CONFLICT (matter_id, user_id) DO NOTHING
    `);
    console.log(`  [committed] assigned creators to ${pendingRows.length} matter(s).`);
  }

  // Final check: any matter with NO assignments at all? (Should be 0 after commit.)
  const orphan = await db.execute(sql`
    SELECT count(*)::int AS n
    FROM matters m
    WHERE NOT EXISTS (
      SELECT 1 FROM matter_assignments a WHERE a.matter_id = m.id
    )
  `);
  const orphanN = rowsOf<{ n: number }>(orphan)[0]?.n ?? 0;
  console.log('');
  console.log(`Matters with NO assignments: ${orphanN}${COMMIT ? ' (should be 0)' : ' (will be 0 after --commit)'}`);

  console.log('');
  console.log(COMMIT ? '=== Done (committed) ===' : '=== Dry run complete — re-run with --commit to write ===');
  console.log('');
  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});