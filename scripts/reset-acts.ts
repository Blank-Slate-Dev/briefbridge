// scripts/reset-acts.ts
//
// Fully removes one or more Commonwealth Acts from the database so they can be
// cleanly re-ingested as if new: deletes their section embeddings, then their
// sections, then the legislation row itself — in FK-safe order.
//
// WHY THIS EXISTS
// ---------------
// Two facts make a plain re-ingest unsafe:
//   1. The batch ingester (ingest-tier1-acts.ts) SKIPS Acts already in the DB
//      (resume semantics), so it can't re-ingest one on its own.
//   2. The single-Act Cth ingester drops sections on re-ingest but does NOT
//      clean their embeddings (legislation_section_embeddings has no FK to
//      sections). A plain re-ingest would therefore leave orphan embedding
//      rows pointing at deleted section IDs.
// Resetting an Act to a clean slate solves both: the batch then treats it as
// new and re-fetches it, and there are no embeddings left to orphan.
//
// USAGE (registration IDs as separate args — avoids PowerShell comma-splitting):
//   npx tsx --env-file=.env.local scripts/reset-acts.ts C2004A01697 C2004A04868

import { config } from 'dotenv';
config({ path: '.env.local' });
import postgres from 'postgres';

async function main(): Promise<void> {
  const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (ids.length === 0) {
    console.error(
      'Usage: npx tsx --env-file=.env.local scripts/reset-acts.ts <registration_id> [<registration_id> ...]',
    );
    process.exit(1);
  }

  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  try {
    for (const regId of ids) {
      console.log(`\n=== resetting ${regId} ===`);

      const leg = await sql`
        SELECT id, short_title FROM legislation
        WHERE registration_id = ${regId} AND jurisdiction = 'commonwealth'
        LIMIT 1
      `;
      if (leg.length === 0) {
        console.log(`  not found (jurisdiction=commonwealth) — skipping`);
        continue;
      }
      const legislationId = leg[0].id as string;
      const shortTitle = leg[0].short_title as string;

      // 1. Delete embeddings for this Act's sections (no FK → manual cleanup).
      const delEmb = await sql`
        DELETE FROM legislation_section_embeddings
        WHERE section_id IN (
          SELECT id FROM legislation_sections WHERE legislation_id = ${legislationId}
        )
      `;
      console.log(`  deleted ${delEmb.count} embedding(s)`);

      // 2. Delete the Act's sections.
      const delSec = await sql`
        DELETE FROM legislation_sections WHERE legislation_id = ${legislationId}
      `;
      console.log(`  deleted ${delSec.count} section(s)`);

      // 3. Delete the legislation row itself.
      await sql`DELETE FROM legislation WHERE id = ${legislationId}`;
      console.log(`  deleted legislation row (${shortTitle})`);
    }
    console.log(
      `\nReset complete for ${ids.length} Act(s). Re-run the batch ingester to re-ingest them.`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});