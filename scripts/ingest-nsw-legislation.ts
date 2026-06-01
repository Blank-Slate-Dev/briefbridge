// scripts/ingest-nsw-legislation.ts
//
// Ingest a single NSW Act from a local XML file downloaded from
// legislation.nsw.gov.au.
//
// Usage:
//   # Live ingest
//   npx tsx --env-file=.env.local scripts/ingest-nsw-legislation.ts \
//     --from-file="C:\Users\osr99\Downloads\act-2002-022_2022-06-16.xml"
//
//   # Dry-run: parse + print, no DB writes
//   npx tsx --env-file=.env.local scripts/ingest-nsw-legislation.ts \
//     --from-file="C:\Users\osr99\Downloads\act-2002-022_2022-06-16.xml" \
//     --dry-run
//
//   # Override metadata read from the XML root (rarely needed — the parser
//   # reads it directly from <exdoc> attributes, which is the whole point
//   # of choosing XML over HTML for NSW)
//   npx tsx --env-file=.env.local scripts/ingest-nsw-legislation.ts \
//     --from-file="..." --registration-id=act-2002-022 --short-title="Civil Liability Act 2002"
//
// =============================================================================
// WHY FILE-BASED (NOT FETCH)
// =============================================================================
//
// legislation.nsw.gov.au is fronted by Cloudflare bot detection. Direct HTTP
// fetches during the parser-design phase were blocked (verified). Rather than
// build a fragile UA-spoofing / cookie-handling bypass, we ingest from local
// XML files the user downloads via browser. For ~17 priority NSW Acts that's
// a perfectly reasonable workflow; we can add automated fetch later if and
// when it's worth the engineering.
//
// =============================================================================
// FLOW (mirrors scripts/ingest-legislation.ts for the Cth side)
// =============================================================================
//
// 1. Read XML from --from-file.
// 2. Parse via lib/legislation/parser-nsw.ts. The parser reads ALL act-level
//    metadata (registrationId, shortTitle, longTitle, year, number) straight
//    from <exdoc> root attributes — no extraction step, no truncation risk.
// 3. If --dry-run, print the parsed tree + first 20 sections and exit.
// 4. Otherwise, upsert the legislation row.
// 5. ⚠ CLEAN UP ORPHAN EMBEDDINGS BEFORE DROPPING SECTIONS. The schema has
//    no FK from legislation_section_embeddings → legislation_sections; on
//    re-ingest, sections get fresh UUIDs and embeddings keyed by the old
//    section_ids become orphans forever. This is the bug that produced
//    stale embedded_text during the Cth citation fix. Doing it correctly
//    here from the start.
// 6. Delete existing sections for this Act.
// 7. Two-pass insert: insert sections in document order, then link
//    parent_section_id FKs via parentIndex.
//
// Idempotency: the legislation row uses (jurisdiction, registration_id) as
// natural key. Re-running this script for the same Act REPLACES its sections.
// =============================================================================

import { readFileSync, existsSync } from 'node:fs';
import { eq, and, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import {
  legislation,
  legislationSections,
  legislationSectionEmbeddings,
  type NewLegislation,
  type NewLegislationSection,
  type LegislationParseStatus,
} from '@/lib/db/schema';
import { parseNswLegislationXml } from '@/lib/legislation/parser-nsw';
import { buildActCitation } from '@/lib/legislation/citations';
import { buildAttribution } from '@/lib/legislation/attribution';

// =============================================================================
// Argument parsing
// =============================================================================

interface Args {
  fromFile: string;
  dryRun: boolean;
  registrationId?: string; // override (defaults to <exdoc id>)
  shortTitle?: string; // override (defaults to <exdoc title>)
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

  const fromFile = get('from-file');
  if (!fromFile) {
    console.error(`
Usage: npx tsx --env-file=.env.local scripts/ingest-nsw-legislation.ts \\
         --from-file=<path-to-act-xml> \\
         [--dry-run] \\
         [--registration-id=<override>] \\
         [--short-title=<override>]

Examples:
  # Dry-run on the Civil Liability Act XML you downloaded
  npx tsx --env-file=.env.local scripts/ingest-nsw-legislation.ts \\
    --from-file="$env:USERPROFILE\\Downloads\\act-2002-022_2022-06-16.xml" \\
    --dry-run
`);
    process.exit(1);
  }

  return {
    fromFile,
    dryRun: has('dry-run'),
    registrationId: get('registration-id'),
    shortTitle: get('short-title'),
  };
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const args = parseArgs();

  // ---- Read XML ----
  if (!existsSync(args.fromFile)) {
    throw new Error(`File not found: ${args.fromFile}`);
  }
  console.log(`[fetch] reading from local file ${args.fromFile}`);
  const xml = readFileSync(args.fromFile, 'utf-8');
  console.log(`[fetch] read ${xml.length.toLocaleString()} bytes`);

  // ---- Parse ----
  console.log(`[parse] starting`);
  const result = parseNswLegislationXml(xml);

  // Resolve metadata (XML attributes are authoritative; CLI args only override).
  const registrationId = args.registrationId ?? result.meta.registrationId;
  const shortTitle = args.shortTitle ?? result.meta.shortTitle;
  if (!registrationId || !shortTitle) {
    throw new Error(
      `Missing registrationId or shortTitle. XML <exdoc> attributes returned ` +
        `registrationId="${result.meta.registrationId ?? ''}", ` +
        `shortTitle="${result.meta.shortTitle ?? ''}". ` +
        `Pass --registration-id / --short-title to override if the XML is malformed.`,
    );
  }

  const actCitation = buildActCitation(shortTitle, 'nsw');
  console.log(`[citation] ${actCitation}`);
  console.log(`[parse] sections: ${result.sections.length}`);
  console.log(
    `[parse] compilationDate=${result.compilationDate ?? '(none)'} ` +
      `year=${result.meta.year ?? '(none)'} number=${result.meta.number ?? '(none)'}`,
  );
  console.log(
    `[parse] longTitle: ${result.meta.longTitle ? result.meta.longTitle.slice(0, 100) + '…' : '(none)'}`,
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

  // Summarise the parsed tree by level.
  const byLevel: Record<string, number> = {};
  for (const s of result.sections) byLevel[s.level] = (byLevel[s.level] || 0) + 1;
  console.log(`[parse] by level:`);
  for (const [level, count] of Object.entries(byLevel)) {
    console.log(`         ${level.padEnd(16)} ${count}`);
  }

  // Determine parse status for the legislation row.
  const parseStatus: LegislationParseStatus =
    result.sections.length === 0
      ? 'zero_sections'
      : result.warnings.length > 0
        ? 'partial'
        : 'ok';
  console.log(`[parse] parseStatus: ${parseStatus}`);

  // ---- Dry-run: print first 20 sections and exit ----
  if (args.dryRun) {
    console.log(`\n[dry-run] first 20 parsed sections:`);
    for (const s of result.sections.slice(0, 20)) {
      const headingDisplay = s.heading ? ` — "${s.heading}"` : '';
      const textPreview =
        s.text.length > 80 ? s.text.slice(0, 80) + '...' : s.text;
      console.log(
        `  [${s.sortOrder.toString().padStart(4)}] ${s.level.padEnd(16)} ${s.number}${headingDisplay}`,
      );
      if (textPreview) console.log(`         text: ${textPreview}`);
      console.log(`         citation: ${s.citation}`);
      console.log(`         breadcrumb: ${s.breadcrumb}`);
    }
    console.log(`\n[dry-run] not writing to DB. Re-run without --dry-run to ingest.`);
    return;
  }

  // ---- DB ingest ----
  const dbUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? null;
  if (!dbUrl) {
    throw new Error(
      `DATABASE_URL (or POSTGRES_URL) env var must be set to ingest into the database. ` +
        `Use 'npx tsx --env-file=.env.local ...' or set the var manually.`,
    );
  }
  const sql = postgres(dbUrl, { max: 5 });
  const db = drizzle(sql);

  try {
    const compilationDate = result.compilationDate ?? today();
    const attribution = buildAttribution('nsw', new Date());

    // Canonical source URL — date-anchored whole-Act HTML view.
    // This is the URL a lawyer would click to read the Act as a human.
    const sourceUrl = `https://legislation.nsw.gov.au/view/whole/html/inforce/${compilationDate}/${registrationId}`;

    const legislationRow: NewLegislation = {
      registrationId,
      jurisdiction: 'nsw',
      kind: 'act',
      shortTitle,
      longTitle: result.meta.longTitle,
      year: result.meta.year,
      number: result.meta.number,
      citation: actCitation,
      compilationDate,
      compilationNumber: null, // NSW has no Cth-style compilation number
      nextAmendmentDate: null,
      sourceUrl,
      attributionText: attribution,
      retrievedAt: new Date(),
      inForce: true,
      repealedAt: null,
      parseStatus,
    };

    // Natural key: (jurisdiction, registration_id).
    const existing = await db
      .select()
      .from(legislation)
      .where(
        and(
          eq(legislation.jurisdiction, 'nsw'),
          eq(legislation.registrationId, registrationId),
        ),
      )
      .limit(1);

    let legislationId: string;

    if (existing.length > 0) {
      legislationId = existing[0].id;
      console.log(`[db] existing legislation row: ${legislationId} — updating`);
      await db
        .update(legislation)
        .set({ ...legislationRow, updatedAt: new Date() })
        .where(eq(legislation.id, legislationId));

      // CLEAN UP ORPHAN EMBEDDINGS BEFORE DROPPING SECTIONS.
      // Section rows have UUID PKs; on re-insert they get fresh IDs, so
      // existing embeddings keyed by old IDs become unreachable orphans.
      // The schema has no FK cascade for this, so we delete explicitly.
      const oldSectionRows = await db
        .select({ id: legislationSections.id })
        .from(legislationSections)
        .where(eq(legislationSections.legislationId, legislationId));
      const oldSectionIds = oldSectionRows.map((r) => r.id);
      if (oldSectionIds.length > 0) {
        const deletedEmb = await db
          .delete(legislationSectionEmbeddings)
          .where(inArray(legislationSectionEmbeddings.sectionId, oldSectionIds))
          .returning({ id: legislationSectionEmbeddings.sectionId });
        console.log(
          `[db] deleted ${deletedEmb.length} old embeddings (would have been orphans)`,
        );
      }

      // Now drop the sections themselves.
      await db
        .delete(legislationSections)
        .where(eq(legislationSections.legislationId, legislationId));
      console.log(`[db] dropped ${oldSectionIds.length} existing sections`);
    } else {
      const [inserted] = await db
        .insert(legislation)
        .values(legislationRow)
        .returning({ id: legislation.id });
      legislationId = inserted.id;
      console.log(`[db] inserted new legislation row: ${legislationId}`);
    }

    // ---- Insert sections (two-pass, identical to Cth ingester) ----
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

    console.log(`\n[done] ingested ${shortTitle}`);
    console.log(`       legislation_id: ${legislationId}`);
    console.log(`       sections:       ${insertedIds.length}`);
    console.log(`       compilation:    ${compilationDate}`);
    console.log(`       parseStatus:    ${parseStatus}`);
    console.log(`       source URL:     ${sourceUrl}`);
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