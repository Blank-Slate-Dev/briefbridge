// scripts/ingest-legislation.ts
//
// Ingest a single Commonwealth Act from legislation.gov.au.
//
// Usage:
//   npm run ingest:legislation -- --registration-id=C2004A03712 --short-title="Privacy Act 1988"
//   npm run ingest:legislation -- --registration-id=C2004A03712 --short-title="Privacy Act 1988" --dry-run
//
// Or with the path-style URL if you already have a known compilation date:
//   npm run ingest:legislation -- \
//     --registration-id=C2004A03712 \
//     --short-title="Privacy Act 1988" \
//     --compilation-date=2025-02-01
//
// =============================================================================
// FLOW
// =============================================================================
//
// 1. Resolve the source URL(s) from the registration ID + compilation date.
//    Large Acts span multiple document_N.html files; fetchActHtml() walks
//    them all and returns combined HTML.
// 2. Optionally cache the combined HTML to disk.
// 3. Parse it via lib/legislation/parser.ts.
// 4. If --dry-run, print the parsed tree and exit.
// 5. Otherwise, insert/update the legislation row.
// 6. Delete any existing sections for this Act (so re-ingest is a clean replace).
// 7. Insert sections in document order, linking parent FKs after the first pass.
// 8. Report counts.
//
// Idempotency: the legislation row uses (jurisdiction, registration_id) as
// natural key. Re-running this script for the same Act REPLACES its sections
// (drops + re-inserts) — useful when the compilation has updated.
//
// =============================================================================
// MULTI-DOCUMENT FETCH NOTE
// =============================================================================
//
// Prior to May 2026 this script fetched only document_1.html, silently
// truncating large Acts like Fair Work Act 2009 (which spans 4 documents).
// fetchActHtml() in lib/legislation/fetch.ts now probes documents in order
// until a 404, concatenates their bodies, and returns combined HTML. The
// --save-html cache file reflects the COMBINED HTML, not the first doc only.

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { eq, and } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import {
  legislation,
  legislationSections,
  type NewLegislation,
  type NewLegislationSection,
} from '@/lib/db/schema';
import { parseLegislationHtml } from '@/lib/legislation/parser';
import { buildActCitation } from '@/lib/legislation/citations';
import { buildAttribution } from '@/lib/legislation/attribution';
import { fetchActHtml, buildActUrl } from '@/lib/legislation/fetch';

// =============================================================================
// Argument parsing
// =============================================================================

interface Args {
  registrationId: string;
  shortTitle: string;
  compilationDate?: string; // ISO date 'YYYY-MM-DD'
  dryRun: boolean;
  fromFile?: string; // For local debugging — skip the HTTP fetch
  saveHtml: boolean; // Save the fetched HTML for offline debugging
  longTitle?: string;
  year?: number;
  number?: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const flag = argv.find((a) => a.startsWith(`--${name}=`));
    if (flag) return flag.slice(`--${name}=`.length);
    const idx = argv.indexOf(`--${name}`);
    if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith('--')) {
      return argv[idx + 1];
    }
    return undefined;
  };
  const has = (name: string): boolean => argv.includes(`--${name}`);

  const registrationId = get('registration-id');
  const shortTitle = get('short-title');
  if (!registrationId || !shortTitle) {
    console.error(`
Usage: npm run ingest:legislation -- \\
         --registration-id=C2004A03712 \\
         --short-title="Privacy Act 1988" \\
         [--compilation-date=2025-02-01] \\
         [--dry-run] \\
         [--from-file=./privacy-act-doc1.html] \\
         [--save-html]
`);
    process.exit(1);
  }

  return {
    registrationId,
    shortTitle,
    compilationDate: get('compilation-date'),
    dryRun: has('dry-run'),
    fromFile: get('from-file'),
    saveHtml: has('save-html'),
    longTitle: get('long-title'),
    year: get('year') ? parseInt(get('year')!, 10) : undefined,
    number: get('number') ? parseInt(get('number')!, 10) : undefined,
  };
}

// =============================================================================
// HTML loading
// =============================================================================

/**
 * Load HTML from disk. Used by the --from-file flag for offline debugging.
 */
function loadHtmlFromFile(filepath: string): string {
  console.log(`[fetch] reading from local file ${filepath}`);
  if (!existsSync(filepath)) {
    throw new Error(`File not found: ${filepath}`);
  }
  const html = readFileSync(filepath, 'utf-8');
  console.log(`[fetch] read ${html.length.toLocaleString()} bytes`);
  return html;
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const args = parseArgs();

  // Compilation date is required for live fetches (the /latest redirect
  // resolution isn't implemented yet — look it up at
  // https://www.legislation.gov.au/{registrationId}/latest if you don't
  // have it).
  if (!args.fromFile && !args.compilationDate) {
    throw new Error(
      `--compilation-date is required (the /latest redirect resolution isn't implemented yet). ` +
        `Look up the current compilation date at ` +
        `https://www.legislation.gov.au/${args.registrationId}/latest`,
    );
  }

  // Resolve HTML — either from a local file or by fetching all document_N
  // files from legislation.gov.au.
  let html: string;
  let sourceUrl: string;

  if (args.fromFile) {
    html = loadHtmlFromFile(args.fromFile);
    // For the legislation row's source_url we still record the canonical
    // document_1 URL when the date is known, otherwise leave it as the file.
    sourceUrl = args.compilationDate
      ? buildActUrl(args.registrationId, args.compilationDate, 1)
      : args.fromFile;
  } else {
    const compilationDate = args.compilationDate!; // guarded above
    const fetchResult = await fetchActHtml(args.registrationId, compilationDate);
    html = fetchResult.html;
    // Record document_1's URL as the canonical source_url in the DB. The
    // existence of additional documents is implicit — the fetcher rediscovers
    // them on re-ingest.
    sourceUrl = buildActUrl(args.registrationId, compilationDate, 1);
  }

  // Optionally save the combined HTML for re-runs without re-fetching.
  // Note: this is the COMBINED HTML (all documents merged), which is what
  // the parser actually sees — useful for offline reproduction of bugs.
  if (args.saveHtml) {
    const debugDir = path.join(process.cwd(), '.legislation-cache');
    if (!existsSync(debugDir)) mkdirSync(debugDir, { recursive: true });
    const cachePath = path.join(debugDir, `${args.registrationId}.html`);
    writeFileSync(cachePath, html, 'utf-8');
    console.log(`[cache] saved combined HTML to ${cachePath}`);
  }

  // Build the act-level citation.
  const actCitation = buildActCitation(args.shortTitle, 'commonwealth');
  console.log(`[citation] ${actCitation}`);

  // Parse.
  console.log(`[parse] starting`);
  const result = parseLegislationHtml(html, {
    actCitation,
    jurisdiction: 'commonwealth',
  });
  console.log(`[parse] sections: ${result.sections.length}`);
  console.log(
    `[parse] compilation: date=${result.compilationDate ?? '(none)'} no=${result.compilationNumber ?? '(none)'}`,
  );
  if (result.warnings.length > 0) {
    console.log(`[parse] warnings: ${result.warnings.length}`);
    for (const w of result.warnings.slice(0, 10)) {
      console.log(`  - ${w}`);
    }
    if (result.warnings.length > 10) {
      console.log(`  ... and ${result.warnings.length - 10} more`);
    }
  }

  // Summarise the parsed tree.
  const byLevel: Record<string, number> = {};
  for (const s of result.sections) {
    byLevel[s.level] = (byLevel[s.level] || 0) + 1;
  }
  console.log(`[parse] by level:`);
  for (const [level, count] of Object.entries(byLevel)) {
    console.log(`         ${level.padEnd(12)} ${count}`);
  }

  // Dry-run mode: print the first ~20 sections and exit.
  if (args.dryRun) {
    console.log(`\n[dry-run] first 20 parsed sections:`);
    for (const s of result.sections.slice(0, 20)) {
      const headingDisplay = s.heading ? ` — "${s.heading}"` : '';
      const textPreview =
        s.text.length > 80 ? s.text.slice(0, 80) + '...' : s.text;
      console.log(
        `  [${s.sortOrder.toString().padStart(4)}] ${s.level.padEnd(11)} ${s.number}${headingDisplay}`,
      );
      if (textPreview) {
        console.log(`         text: ${textPreview}`);
      }
      console.log(`         citation: ${s.citation}`);
      console.log(`         breadcrumb: ${s.breadcrumb}`);
    }
    console.log(`\n[dry-run] not writing to DB. Re-run without --dry-run to ingest.`);
    return;
  }

  // Compilation date: use parsed one, then arg one, then today.
  const compilationDate =
    result.compilationDate ?? args.compilationDate ?? today();

  // Connect to DB.
  const dbUrl =
    process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? null;
  if (!dbUrl) {
    throw new Error(
      `DATABASE_URL (or POSTGRES_URL) env var must be set to ingest into the database.`,
    );
  }
  const sql = postgres(dbUrl, { max: 5 });
  const db = drizzle(sql);

  try {
    // Upsert the legislation row.
    const attribution = buildAttribution('commonwealth', new Date());

    const legislationRow: NewLegislation = {
      registrationId: args.registrationId,
      jurisdiction: 'commonwealth',
      kind: 'act',
      shortTitle: args.shortTitle,
      longTitle: args.longTitle ?? null,
      year: args.year ?? null,
      number: args.number ?? null,
      citation: actCitation,
      compilationDate,
      compilationNumber: result.compilationNumber ?? null,
      nextAmendmentDate: null,
      sourceUrl,
      attributionText: attribution,
      retrievedAt: new Date(),
      inForce: true,
      repealedAt: null,
    };

    // Check if already exists.
    const existing = await db
      .select()
      .from(legislation)
      .where(
        and(
          eq(legislation.jurisdiction, 'commonwealth'),
          eq(legislation.registrationId, args.registrationId),
        ),
      )
      .limit(1);

    let legislationId: string;

    if (existing.length > 0) {
      legislationId = existing[0].id;
      console.log(`[db] existing legislation row: ${legislationId} — updating`);
      await db
        .update(legislation)
        .set({
          ...legislationRow,
          updatedAt: new Date(),
        })
        .where(eq(legislation.id, legislationId));

      // Drop existing sections — we're going to re-insert.
      await db
        .delete(legislationSections)
        .where(eq(legislationSections.legislationId, legislationId));
      console.log(`[db] dropped existing sections`);
    } else {
      const [inserted] = await db
        .insert(legislation)
        .values(legislationRow)
        .returning({ id: legislation.id });
      legislationId = inserted.id;
      console.log(`[db] inserted new legislation row: ${legislationId}`);
    }

    // Insert sections. Because sections have parent FK references to
    // OTHER sections, we have to do this in two passes:
    //   Pass 1: insert all sections WITHOUT parent links, capture IDs.
    //   Pass 2: update each with its parent's ID using the parentIndex.
    //
    // (Alternative: topological sort and insert leaves first. But the
    //  parser already gives us document order = topological order, so a
    //  two-pass is simpler.)

    console.log(`[db] inserting ${result.sections.length} sections (pass 1)`);
    const rows: NewLegislationSection[] = result.sections.map((s) => ({
      legislationId,
      parentSectionId: null, // pass 2 sets this
      level: s.level,
      number: s.number,
      heading: s.heading,
      text: s.text,
      citation: s.citation,
      breadcrumb: s.breadcrumb,
      path: s.path,
      sortOrder: s.sortOrder,
      embeddedAt: null,
    }));

    // Insert in batches to avoid massive single statements.
    const BATCH = 500;
    const insertedIds: string[] = [];
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const insertedBatch = await db
        .insert(legislationSections)
        .values(slice)
        .returning({ id: legislationSections.id });
      insertedIds.push(...insertedBatch.map((r) => r.id));
    }
    console.log(`[db] inserted ${insertedIds.length} sections`);

    // Pass 2: update parent FKs.
    console.log(`[db] linking parent FKs (pass 2)`);
    let linkedCount = 0;
    for (let i = 0; i < result.sections.length; i++) {
      const parsedSection = result.sections[i];
      if (parsedSection.parentIndex === -1) continue;
      const myId = insertedIds[i];
      const parentId = insertedIds[parsedSection.parentIndex];
      await db
        .update(legislationSections)
        .set({ parentSectionId: parentId })
        .where(eq(legislationSections.id, myId));
      linkedCount++;
    }
    console.log(`[db] linked ${linkedCount} parent references`);

    console.log(`\n[done] ingested ${args.shortTitle}`);
    console.log(`       legislation_id: ${legislationId}`);
    console.log(`       sections: ${insertedIds.length}`);
    console.log(`       compilation: ${compilationDate}`);
  } finally {
    await sql.end();
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

main().catch((err) => {
  console.error(`[error] ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});