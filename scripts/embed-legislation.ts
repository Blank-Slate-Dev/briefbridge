// scripts/embed-legislation.ts
//
// Bulk embedding for legislation_sections. Reads leaf-level rows (sections
// and schedule_clauses with non-empty body text), constructs an embedding
// text that includes the breadcrumb prefix and heading, embeds via Voyage
// AI, and stores the result in legislation_section_embeddings + flips
// legislation_sections.embedded_at.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/embed-legislation.ts
//   npx tsx --env-file=.env.local scripts/embed-legislation.ts -- --limit 100
//   npx tsx --env-file=.env.local scripts/embed-legislation.ts -- --legislation-id <uuid>
//   npx tsx --env-file=.env.local scripts/embed-legislation.ts -- --fast
//
// Resumability:
//   Skips rows whose embedded_at is non-null. Stop with Ctrl+C and re-run
//   to pick up where it left off.
//
// Throttling:
//   Defaults to the same Nano-tier-safe pacing as embed-judgments.ts.
//   Pass --fast for larger compute tiers.
//
// What gets embedded:
//   - level IN ('section', 'schedule_clause') only — structural rows
//     (chapter, part, division, etc.) have no body text, embedding them
//     would pollute retrieval with low-signal "this is Part III" vectors.
//   - text != '' — extra defensive filter; empty-text leaves shouldn't
//     exist for the levels above, but if any do, skip them.
//
// What the embedded text looks like:
//   "[Privacy Act 1988 (Cth) > Part III > Division 1] s 16A — When an APP
//    entity must take steps
//    (body of section 16A here)"
//
//   The breadcrumb prefix in square brackets gives Voyage semantic
//   context that the body text alone often lacks. A section that opens
//   with "(1) An APP entity must..." doesn't carry the word "privacy"
//   anywhere in its body, so without the prefix it wouldn't match a
//   query like "privacy obligations".
//
// Monster section handling:
//   Two known sections exceed 50K chars (the master definitions
//   sections of Corp Act s 9 and FWA s 12). We truncate the embedded
//   text at ~50K chars — the full text stays in legislation_sections,
//   the embedding is just for retrieval routing. Tradeoff documented
//   in the design discussion; revisit if retrieval on definition
//   sections turns out to be problematic.

import 'dotenv/config';
import { sql, eq, and, isNull, inArray, ne } from 'drizzle-orm';
import { db, schema } from '../lib/db';
import { embed, batchTexts, type VoyageModel } from '../lib/embeddings/voyage';

// =============================================================================
// Configuration
// =============================================================================

const MODEL: VoyageModel = 'voyage-law-2';

// Voyage's per-text token limit is ~16K. 50K chars ≈ 14K tokens at the
// dense-legal-text rate of ~3.5 chars/token, leaving headroom for the
// breadcrumb prefix.
const MAX_EMBED_CHARS = 50_000;

// Minimum text length to bother embedding. Some `schedule_clause` rows
// (Privacy Act APP intros) are 1-2 sentences. Anything shorter than 50
// chars is probably an artefact and pollutes the index.
const MIN_EMBED_CHARS = 50;

// =============================================================================
// Throttling — same as embed-judgments.ts
// =============================================================================

interface ThrottleConfig {
  insertChunkSize: number;
  delayBetweenInsertChunksMs: number;
  delayBetweenLegislationMs: number;
  delayBetweenVoyageBatchesMs: number;
}

const THROTTLE_DEFAULT: ThrottleConfig = {
  insertChunkSize: 50,
  delayBetweenInsertChunksMs: 300,
  delayBetweenLegislationMs: 1500,
  delayBetweenVoyageBatchesMs: 250,
};

const THROTTLE_FAST: ThrottleConfig = {
  insertChunkSize: 100,
  delayBetweenInsertChunksMs: 0,
  delayBetweenLegislationMs: 0,
  delayBetweenVoyageBatchesMs: 0,
};

const sleep = (ms: number) =>
  ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();

// =============================================================================
// CLI argument parsing
// =============================================================================

interface CliArgs {
  limit: number | null;
  legislationId: string | null;
  fast: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { limit: null, legislationId: null, fast: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--limit':
        args.limit = parseInt(argv[++i], 10);
        break;
      case '--legislation-id':
        args.legislationId = argv[++i];
        break;
      case '--fast':
        args.fast = true;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
      default:
        console.error(`Unknown argument: ${argv[i]}`);
        printUsage();
        process.exit(1);
    }
  }
  return args;
}

function printUsage(): void {
  console.log(`
Usage: npx tsx --env-file=.env.local scripts/embed-legislation.ts [flags]

Flags:
  --limit <n>             Process at most N sections (smoke testing).
  --legislation-id <uuid> Embed only sections of this one Act.
  --fast                  Disable throttling. Use only on larger compute tiers.
  --help, -h              Show this help.

Examples:
  npx tsx --env-file=.env.local scripts/embed-legislation.ts
  npx tsx --env-file=.env.local scripts/embed-legislation.ts --limit 20
  npx tsx --env-file=.env.local scripts/embed-legislation.ts --legislation-id <uuid>
  `.trim());
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const throttle = args.fast ? THROTTLE_FAST : THROTTLE_DEFAULT;

  console.log('========================================');
  console.log('BriefBridge legislation embedding pipeline');
  console.log('========================================');
  console.log(`Model:        ${MODEL}`);
  console.log(`Max chars:    ${MAX_EMBED_CHARS.toLocaleString()} per embed`);
  console.log(`Min chars:    ${MIN_EMBED_CHARS} (shorter sections skipped)`);
  console.log(`Mode:         ${args.fast ? 'FAST (no throttling)' : 'GENTLE (throttled for Nano tier)'}`);
  if (!args.fast) {
    console.log(`              insert chunk: ${throttle.insertChunkSize} rows`);
    console.log(`              delay between chunks: ${throttle.delayBetweenInsertChunksMs}ms`);
    console.log(`              delay between Acts: ${throttle.delayBetweenLegislationMs}ms`);
  }
  if (args.limit) console.log(`Limit:        ${args.limit} sections`);
  if (args.legislationId) console.log(`Target Act:   ${args.legislationId}`);
  console.log('========================================\n');

  // ----- Phase 1: find rows to embed -----
  console.log('[phase 1] Finding sections to embed...');

  // Build conditions:
  //   - level must be a content-leaf level
  //   - text must be non-empty
  //   - embedded_at must still be NULL (resumability)
  //   - optional: scoped to one legislation_id
  const conditions = [
    inArray(schema.legislationSections.level, ['section', 'schedule_clause']),
    ne(schema.legislationSections.text, ''),
    isNull(schema.legislationSections.embeddedAt),
  ];
  if (args.legislationId) {
    conditions.push(
      eq(schema.legislationSections.legislationId, args.legislationId),
    );
  }

  // Pull the columns we need. We JOIN to legislation to get the short_title
  // for logging — not for the embedded text (the section's own pre-computed
  // citation column already encodes the Act name).
  const baseQuery = db
    .select({
      id: schema.legislationSections.id,
      legislationId: schema.legislationSections.legislationId,
      legislationTitle: schema.legislation.shortTitle,
      level: schema.legislationSections.level,
      number: schema.legislationSections.number,
      heading: schema.legislationSections.heading,
      text: schema.legislationSections.text,
      citation: schema.legislationSections.citation,
      breadcrumb: schema.legislationSections.breadcrumb,
      sortOrder: schema.legislationSections.sortOrder,
    })
    .from(schema.legislationSections)
    .innerJoin(
      schema.legislation,
      eq(schema.legislation.id, schema.legislationSections.legislationId),
    )
    .where(and(...conditions))
    .orderBy(
      schema.legislationSections.legislationId,
      schema.legislationSections.sortOrder,
    );

  const rows = args.limit ? await baseQuery.limit(args.limit) : await baseQuery;
  console.log(`  [info] Found ${rows.length} sections to embed.\n`);

  if (rows.length === 0) {
    console.log('Nothing to embed. (All target sections already have embeddings.)');
    return;
  }

  // Estimate work — rough by char count for a fast preview.
  const totalChars = rows.reduce((sum, r) => sum + Math.min(r.text.length, MAX_EMBED_CHARS), 0);
  const estimatedTokens = Math.ceil(totalChars / 3.5);
  const estimatedCost = (estimatedTokens / 1_000_000) * 0.12;
  console.log(`[phase 2] Estimated:`);
  console.log(`  ~${totalChars.toLocaleString()} chars`);
  console.log(`  ~${estimatedTokens.toLocaleString()} tokens`);
  console.log(`  ~$${estimatedCost.toFixed(2)} USD (after free tier)\n`);

  // ----- Phase 3: embed -----
  // Group rows by legislation_id so we can report progress per-Act and
  // pause between Acts (gentler on the DB than no pauses, finer-grained
  // than per-section pauses).
  const groupedByAct = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = groupedByAct.get(r.legislationId) ?? [];
    list.push(r);
    groupedByAct.set(r.legislationId, list);
  }

  let totalEmbedded = 0;
  let totalSkipped = 0;
  let totalTruncated = 0;
  let totalTokens = 0;
  let totalApiCalls = 0;
  let consecutiveFailures = 0;
  const startTime = Date.now();

  const actGroups = [...groupedByAct.entries()];
  for (let actIdx = 0; actIdx < actGroups.length; actIdx++) {
    const [legislationId, actRows] = actGroups[actIdx];
    const actTitle = actRows[0].legislationTitle;
    const progress = `[Act ${actIdx + 1}/${actGroups.length}]`;
    console.log(`\n${progress} ${actTitle} — ${actRows.length} sections`);

    try {
      const result = await embedOneAct(actRows, throttle);
      totalEmbedded += result.embedded;
      totalSkipped += result.skipped;
      totalTruncated += result.truncated;
      totalTokens += result.tokens;
      totalApiCalls += result.apiCalls;
      consecutiveFailures = 0;

      console.log(
        `  → ${result.embedded} embedded, ${result.skipped} skipped, ` +
          `${result.truncated} truncated, ${result.apiCalls} API calls`,
      );
    } catch (err) {
      const message = compactErrorMessage(err);
      console.error(`  → ERROR: ${message}`);
      consecutiveFailures++;
      if (consecutiveFailures >= 5) {
        console.error('\n[circuit-breaker] 5 consecutive failures — aborting.');
        console.error('  Likely Supabase IO throttling. Wait a few minutes and re-run.');
        console.error(`  Progress saved: ${totalEmbedded.toLocaleString()} embeddings completed.\n`);
        break;
      }
      await sleep(5000);
    }

    if (actIdx < actGroups.length - 1) {
      await sleep(throttle.delayBetweenLegislationMs);
    }
  }

  // ----- Done -----
  const totalMin = (Date.now() - startTime) / 60_000;
  const realCost = (totalTokens / 1_000_000) * 0.12;
  console.log('\n========================================');
  console.log('Legislation embedding complete.');
  console.log('========================================');
  console.log(`Embedded:    ${totalEmbedded.toLocaleString()} sections`);
  console.log(`Skipped:     ${totalSkipped.toLocaleString()} (too short)`);
  console.log(`Truncated:   ${totalTruncated.toLocaleString()} (over ${MAX_EMBED_CHARS.toLocaleString()} chars)`);
  console.log(`API calls:   ${totalApiCalls.toLocaleString()}`);
  console.log(`Tokens:      ${totalTokens.toLocaleString()}`);
  console.log(`Time:        ${totalMin.toFixed(1)} minutes`);
  console.log(`Est. cost:   ~$${realCost.toFixed(2)} USD`);
  console.log('========================================\n');
}

// =============================================================================
// Embed one Act's sections
// =============================================================================

interface SectionRow {
  id: string;
  legislationId: string;
  legislationTitle: string;
  level: string;
  number: string;
  heading: string | null;
  text: string;
  citation: string;
  breadcrumb: string;
  sortOrder: number;
}

interface EmbedActResult {
  embedded: number;
  skipped: number;
  truncated: number;
  tokens: number;
  apiCalls: number;
}

async function embedOneAct(
  actRows: SectionRow[],
  throttle: ThrottleConfig,
): Promise<EmbedActResult> {
  type Prepared = {
    id: string;
    embeddedText: string;
    truncated: boolean;
  };

  // Build embed texts for every row, filtering out too-short ones.
  const prepared: Prepared[] = [];
  let skipped = 0;
  let truncated = 0;
  for (const row of actRows) {
    const built = buildEmbedText(row);
    if (built.text.length < MIN_EMBED_CHARS) {
      skipped++;
      continue;
    }
    prepared.push({
      id: row.id,
      embeddedText: built.text,
      truncated: built.truncated,
    });
    if (built.truncated) truncated++;
  }

  if (prepared.length === 0) {
    return { embedded: 0, skipped, truncated, tokens: 0, apiCalls: 0 };
  }

  // Batch through Voyage.
  const texts = prepared.map((p) => p.embeddedText);
  const batches = batchTexts(texts);

  let cursor = 0;
  let totalTokens = 0;
  let apiCalls = 0;
  const rowsToInsert: Array<typeof schema.legislationSectionEmbeddings.$inferInsert> = [];

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    const result = await embed({
      texts: batch,
      model: MODEL,
      inputType: 'document',
    });
    apiCalls++;
    totalTokens += result.totalTokens;

    for (let i = 0; i < batch.length; i++) {
      const p = prepared[cursor + i];
      rowsToInsert.push({
        sectionId: p.id,
        embeddedText: p.embeddedText,
        model: MODEL,
        embedding: result.embeddings[i],
      });
    }

    cursor += batch.length;
    if (batchIdx < batches.length - 1) {
      await sleep(throttle.delayBetweenVoyageBatchesMs);
    }
  }

  // Insert in chunks, throttled. Each chunk: write embeddings + flip
  // embedded_at on the sections.
  for (let i = 0; i < rowsToInsert.length; i += throttle.insertChunkSize) {
    const chunk = rowsToInsert.slice(i, i + throttle.insertChunkSize);

    await db.transaction(async (tx) => {
      // Insert the embedding rows.
      await tx.insert(schema.legislationSectionEmbeddings).values(chunk);

      // Flip embedded_at on the sections we just embedded. Doing this in
      // the same transaction keeps the two tables in sync — if either
      // INSERT fails, the transaction rolls back and we'll retry on the
      // next run.
      const ids = chunk.map((r) => r.sectionId);
      await tx
        .update(schema.legislationSections)
        .set({ embeddedAt: sql`NOW()` })
        .where(inArray(schema.legislationSections.id, ids));
    });

    if (i + throttle.insertChunkSize < rowsToInsert.length) {
      await sleep(throttle.delayBetweenInsertChunksMs);
    }
  }

  return {
    embedded: rowsToInsert.length,
    skipped,
    truncated,
    tokens: totalTokens,
    apiCalls,
  };
}

/**
 * Build the text that gets sent to Voyage.
 *
 * Shape:
 *   [Breadcrumb context]
 *   citation — heading
 *   (body text)
 *
 * The breadcrumb provides Act-level + structural context (e.g. "Privacy
 * Act 1988 (Cth) > Part III > Division 1"). The citation gives the
 * AGLC4 reference for this specific row. The heading is the section's
 * own title. Then the body.
 *
 * Why include all three rather than just body? Embedding short or
 * abstract subsections without context yields uninformative vectors.
 * "(1) An APP entity must..." doesn't tell Voyage anything about
 * privacy unless we tell it.
 *
 * Returns the text plus a flag indicating whether truncation happened
 * (for the run-end summary).
 */
function buildEmbedText(row: SectionRow): { text: string; truncated: boolean } {
  // Use the section's pre-computed breadcrumb if present.
  const bc = row.breadcrumb.length > 0
    ? `[${row.legislationTitle} > ${row.breadcrumb}]`
    : `[${row.legislationTitle}]`;

  const header = row.heading
    ? `${row.citation} — ${row.heading}`
    : row.citation;

  const fullText = `${bc}\n${header}\n${row.text}`;

  if (fullText.length <= MAX_EMBED_CHARS) {
    return { text: fullText, truncated: false };
  }

  // Truncate the body, keeping the breadcrumb + header intact. This
  // preserves the part of the embedding that's most discriminating for
  // retrieval (what section is this?), losing only later definitional
  // content. Documented tradeoff for monster definitions sections.
  const prefix = `${bc}\n${header}\n`;
  const bodyBudget = MAX_EMBED_CHARS - prefix.length;
  const truncatedBody = row.text.slice(0, bodyBudget);
  return { text: prefix + truncatedBody, truncated: true };
}

/**
 * Compact error message — same principle as embed-judgments.ts.
 * Never dump raw error objects, they include embedding vectors in
 * insert-error params.
 */
function compactErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message.length > 300
      ? err.message.slice(0, 300) + '…'
      : err.message;
    return msg;
  }
  return String(err).slice(0, 300);
}

// =============================================================================
// Run it
// =============================================================================

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n[fatal error]', compactErrorMessage(err));
    process.exit(1);
  });