// scripts/embed-judgments.ts
//
// Bulk embedding: reads judgments from the database, extracts each paragraph,
// embeds it via Voyage AI, and stores the vector in judgment_embeddings.
//
// Usage:
//   npm run embed:bulk
//   npm run embed:bulk -- --limit 100         # for smoke testing
//   npm run embed:bulk -- --judgment-id <uuid> # for re-embedding one case
//   npm run embed:bulk -- --since 2026-05-01   # for incremental (e.g. nightly)
//   npm run embed:bulk -- --fast               # disable throttling (use cautiously)
//
// Resumability:
//   The script SKIPS judgments that already have embeddings for the current
//   model. If you stop with Ctrl+C and re-run, it picks up where it left off.
//
// Idempotency:
//   Re-running on already-embedded judgments is a no-op (cheap DB query, no
//   API call, no insert).
//
// Throttling:
//   By default the script paces itself to be friendly to Supabase's IO budget
//   on the smallest Pro tier. Insert chunks are smaller (50 rows) with a brief
//   delay between chunks, and a longer delay between judgments. Pass --fast
//   to disable this if you're on a bigger compute tier.

import 'dotenv/config';
import { eq, sql, gte, and, isNull, notExists } from 'drizzle-orm';
import { db, schema } from '../lib/db';
import { embed, batchTexts, type VoyageModel } from '../lib/embeddings/voyage';

// =============================================================================
// Configuration
// =============================================================================

const MODEL: VoyageModel = 'voyage-law-2';

// How many paragraphs to send to Voyage per request.
// Smaller = more responsive cancellation, more progress updates.
// Larger = fewer round trips, slightly faster overall.
// 64 is a good middle ground — Voyage allows up to 128.
const PARAGRAPHS_PER_BATCH = 64;

// Minimum paragraph length (in characters) to embed. Very short paragraphs
// like "[1]" or single-word interjections aren't useful retrieval targets
// and inflate our index for nothing. ~50 chars filters out noise.
const MIN_PARAGRAPH_CHARS = 50;

// =============================================================================
// Throttling — gentle on Supabase's IO budget
// =============================================================================
//
// Supabase's smallest Pro tier ("Nano") has a 43 Mbps baseline disk IO and
// only 30 minutes of burst-above-baseline per day. Vector inserts are
// IO-heavy because every INSERT touches the HNSW index. Without throttling,
// a sustained embed run will exhaust the burst budget within an hour and
// throttle the entire database.
//
// These values keep us under burst and let the Nano tier handle the load.

interface ThrottleConfig {
  /** Rows per database INSERT statement. */
  insertChunkSize: number;
  /** Pause between INSERT chunks within one judgment. */
  delayBetweenInsertChunksMs: number;
  /** Pause between judgments. */
  delayBetweenJudgmentsMs: number;
  /** Pause between Voyage API calls within one judgment (multi-batch cases). */
  delayBetweenVoyageBatchesMs: number;
}

const THROTTLE_DEFAULT: ThrottleConfig = {
  insertChunkSize: 50,
  delayBetweenInsertChunksMs: 300,
  delayBetweenJudgmentsMs: 1500,
  delayBetweenVoyageBatchesMs: 250,
};

const THROTTLE_FAST: ThrottleConfig = {
  insertChunkSize: 100,
  delayBetweenInsertChunksMs: 0,
  delayBetweenJudgmentsMs: 0,
  delayBetweenVoyageBatchesMs: 0,
};

const sleep = (ms: number) =>
  ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();

// =============================================================================
// CLI argument parsing
// =============================================================================

interface CliArgs {
  limit: number | null;
  judgmentId: string | null;
  since: string | null;
  fast: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { limit: null, judgmentId: null, since: null, fast: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--limit':
        args.limit = parseInt(argv[++i], 10);
        break;
      case '--judgment-id':
        args.judgmentId = argv[++i];
        break;
      case '--since':
        args.since = argv[++i];
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
Usage: npm run embed:bulk -- [flags]

Flags:
  --limit <n>           Process at most N judgments (smoke testing).
  --judgment-id <uuid>  Embed only this one judgment (e.g. for re-embedding).
  --since <iso-date>    Only embed judgments ingested since this date.
  --fast                Disable throttling. Use only on larger compute tiers.

Examples:
  npm run embed:bulk
  npm run embed:bulk -- --limit 5
  npm run embed:bulk -- --since 2026-05-01
  `.trim());
}

// =============================================================================
// Types matching what we expect in the paragraphs JSONB column
// =============================================================================

interface ParagraphFromDB {
  number: string;
  text: string;
  heading?: string;
  subItems?: Array<{ number: string; text: string; level: number }>;
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const throttle = args.fast ? THROTTLE_FAST : THROTTLE_DEFAULT;

  console.log('========================================');
  console.log('BriefBridge embedding pipeline');
  console.log('========================================');
  console.log(`Model:    ${MODEL}`);
  console.log(`Batch:    ${PARAGRAPHS_PER_BATCH} paragraphs per Voyage request`);
  console.log(`Min len:  ${MIN_PARAGRAPH_CHARS} chars (shorter paragraphs skipped)`);
  console.log(`Mode:     ${args.fast ? 'FAST (no throttling)' : 'GENTLE (throttled for Nano tier)'}`);
  if (!args.fast) {
    console.log(`          insert chunk: ${throttle.insertChunkSize} rows`);
    console.log(`          delay between chunks: ${throttle.delayBetweenInsertChunksMs}ms`);
    console.log(`          delay between judgments: ${throttle.delayBetweenJudgmentsMs}ms`);
  }
  if (args.limit) console.log(`Limit:    ${args.limit} judgments`);
  if (args.judgmentId) console.log(`Target:   judgment ${args.judgmentId}`);
  if (args.since) console.log(`Since:    ${args.since}`);
  console.log('========================================\n');

  // Find judgments that need embedding.
  // "Need embedding" = they have no rows in judgment_embeddings for this model.
  console.log('[phase 1] Finding judgments to embed...');

  const conditions = [];
  if (args.judgmentId) {
    conditions.push(eq(schema.judgments.id, args.judgmentId));
  }
  if (args.since) {
    conditions.push(gte(schema.judgments.ingestedAt, new Date(args.since)));
  }

  // Subquery: judgments that DON'T have any embedding rows for this model.
  // Using NOT EXISTS is faster than LEFT JOIN ... IS NULL for big tables.
  conditions.push(
    notExists(
      db
        .select({ id: schema.judgmentEmbeddings.id })
        .from(schema.judgmentEmbeddings)
        .where(
          and(
            eq(schema.judgmentEmbeddings.judgmentId, schema.judgments.id),
            eq(schema.judgmentEmbeddings.model, MODEL),
          ),
        ),
    ),
  );

  const judgmentsQuery = db
    .select({
      id: schema.judgments.id,
      citation: schema.judgments.citation,
      paragraphs: schema.judgments.paragraphs,
      paragraphCount: schema.judgments.paragraphCount,
    })
    .from(schema.judgments)
    .where(and(...conditions))
    .orderBy(schema.judgments.ingestedAt);

  const judgments = args.limit
    ? await judgmentsQuery.limit(args.limit)
    : await judgmentsQuery;

  console.log(`  [info] Found ${judgments.length} judgments needing embedding for model "${MODEL}".\n`);

  if (judgments.length === 0) {
    console.log('All judgments are already embedded with this model. Nothing to do.');
    return;
  }

  // Estimate work.
  const totalEstimatedParagraphs = judgments.reduce(
    (sum, j) => sum + (j.paragraphCount ?? 0),
    0,
  );
  console.log(`[phase 2] Estimated ${totalEstimatedParagraphs.toLocaleString()} total paragraphs.`);
  console.log(`         (Some will be skipped if shorter than ${MIN_PARAGRAPH_CHARS} chars.)\n`);

  // -------- Phase 3: embed each judgment --------
  let totalEmbedded = 0;
  let totalSkipped = 0;
  let totalTokens = 0;
  let totalApiCalls = 0;
  let consecutiveFailures = 0; // circuit-breaker
  const startTime = Date.now();

  for (let i = 0; i < judgments.length; i++) {
    const judgment = judgments[i];
    const progress = `[${i + 1}/${judgments.length}]`;
    const label = judgment.citation ?? judgment.id.slice(0, 8);

    try {
      const result = await embedOneJudgment(judgment, throttle);
      totalEmbedded += result.embedded;
      totalSkipped += result.skipped;
      totalTokens += result.tokens;
      totalApiCalls += result.apiCalls;
      consecutiveFailures = 0; // reset on any success
      console.log(
        `  ${progress} ${label} — ${result.embedded} embedded, ${result.skipped} skipped`,
      );
    } catch (err) {
      // CRUCIAL: log only the message, never the full error object.
      // Postgres errors include the row being inserted, which would dump the
      // entire embedding vector (1024 floats) to the terminal. We don't want that.
      const message = compactErrorMessage(err);
      console.error(`  ${progress} ${label} — ERROR: ${message}`);
      consecutiveFailures++;

      // Circuit-breaker: if 5 judgments fail in a row, the database is probably
      // throttled or down. Abort cleanly rather than dump 100 errors to the log.
      if (consecutiveFailures >= 5) {
        console.error('\n[circuit-breaker] 5 consecutive failures — aborting.');
        console.error('  This usually means Supabase has throttled IO or the connection is unhealthy.');
        console.error('  Wait a few minutes for the IO budget to recover, then re-run.');
        console.error(`  Progress saved: ${totalEmbedded.toLocaleString()} paragraphs from ${i + 1 - consecutiveFailures} judgments.\n`);
        break;
      }

      // After a failure, pause longer than the normal cadence to give the DB
      // a chance to recover.
      await sleep(5000);
    }

    // Progress summary every 25 judgments.
    if ((i + 1) % 25 === 0) {
      const elapsedMin = (Date.now() - startTime) / 60_000;
      const ratePerMin = totalEmbedded / Math.max(elapsedMin, 0.01);
      const remainingJudgments = judgments.length - (i + 1);
      const avgEmbeddedPerJudgment = totalEmbedded / (i + 1);
      const remainingEmbeddings = remainingJudgments * avgEmbeddedPerJudgment;
      const etaMin = ratePerMin > 0 ? remainingEmbeddings / ratePerMin : 0;

      console.log(
        `\n  --- progress: ${totalEmbedded.toLocaleString()} embedded | ` +
        `${totalSkipped.toLocaleString()} skipped | ` +
        `${totalApiCalls} API calls | ` +
        `${totalTokens.toLocaleString()} tokens | ` +
        `~${Math.ceil(etaMin)} min remaining ---\n`,
      );
    }

    // Throttle between judgments.
    if (i < judgments.length - 1) {
      await sleep(throttle.delayBetweenJudgmentsMs);
    }
  }

  // -------- Done --------
  const totalMin = (Date.now() - startTime) / 60_000;
  console.log('\n========================================');
  console.log('Embedding complete.');
  console.log('========================================');
  console.log(`Embedded:   ${totalEmbedded.toLocaleString()} paragraphs`);
  console.log(`Skipped:    ${totalSkipped.toLocaleString()} (too short)`);
  console.log(`API calls:  ${totalApiCalls.toLocaleString()}`);
  console.log(`Tokens:     ${totalTokens.toLocaleString()}`);
  console.log(`Time:       ${totalMin.toFixed(1)} minutes`);
  // Voyage's voyage-law-2 is ~$0.12 per million tokens (after free tier).
  const cost = (totalTokens / 1_000_000) * 0.12;
  console.log(`Est. cost:  ~$${cost.toFixed(2)} USD (only billed past free allowance)`);
  console.log('========================================\n');
}

// =============================================================================
// Embed one judgment
// =============================================================================

interface EmbedJudgmentResult {
  embedded: number;
  skipped: number;
  tokens: number;
  apiCalls: number;
}

async function embedOneJudgment(
  judgment: {
    id: string;
    citation: string | null;
    paragraphs: unknown;
    paragraphCount: number | null;
  },
  throttle: ThrottleConfig,
): Promise<EmbedJudgmentResult> {
  const paragraphs = judgment.paragraphs as ParagraphFromDB[];
  if (!Array.isArray(paragraphs)) {
    throw new Error(`Judgment ${judgment.id} has invalid paragraphs (not an array).`);
  }

  // Filter out paragraphs that are too short to be useful retrieval targets.
  // We keep the original index so we can map back when building the row.
  type Indexed = { index: number; number: string; text: string };
  const eligible: Indexed[] = paragraphs
    .map((p, idx) => ({
      index: idx,
      number: p.number,
      text: buildEmbeddableText(p),
    }))
    .filter((p) => p.text.length >= MIN_PARAGRAPH_CHARS);

  const skipped = paragraphs.length - eligible.length;

  if (eligible.length === 0) {
    return { embedded: 0, skipped, tokens: 0, apiCalls: 0 };
  }

  // Batch up the texts for Voyage.
  const texts = eligible.map((p) => p.text);
  const batches = batchTexts(texts);

  let cursor = 0; // index into eligible[]
  let totalTokens = 0;
  let apiCalls = 0;
  const rowsToInsert: Array<typeof schema.judgmentEmbeddings.$inferInsert> = [];

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    const result = await embed({ texts: batch, model: MODEL, inputType: 'document' });
    apiCalls++;
    totalTokens += result.totalTokens;

    for (let i = 0; i < batch.length; i++) {
      const indexed = eligible[cursor + i];
      rowsToInsert.push({
        judgmentId: judgment.id,
        paragraphNumber: indexed.number,
        paragraphIndex: indexed.index,
        paragraphText: indexed.text,
        embedding: result.embeddings[i],
        model: MODEL,
      });
    }

    cursor += batch.length;

    // Tiny pause between Voyage API calls within one judgment (only for
    // multi-batch cases, e.g. 200+ paragraph judgments).
    if (batchIdx < batches.length - 1) {
      await sleep(throttle.delayBetweenVoyageBatchesMs);
    }
  }

  // Insert in chunks to avoid huge single inserts AND to spread out the IO load
  // across multiple smaller writes (gentler on the HNSW index).
  for (let i = 0; i < rowsToInsert.length; i += throttle.insertChunkSize) {
    const chunk = rowsToInsert.slice(i, i + throttle.insertChunkSize);
    await db.insert(schema.judgmentEmbeddings).values(chunk);

    // Pause between insert chunks. This is the most important throttle:
    // every INSERT triggers HNSW index updates which is the IO-heavy part.
    if (i + throttle.insertChunkSize < rowsToInsert.length) {
      await sleep(throttle.delayBetweenInsertChunksMs);
    }
  }

  return { embedded: rowsToInsert.length, skipped, tokens: totalTokens, apiCalls };
}

/**
 * Builds the text we'll embed for a paragraph.
 *
 * Strategy: include the paragraph's text plus any sub-items, joined cleanly.
 * We DON'T include the paragraph number ("[42]") because that's not semantic
 * content — including it would just add noise to the embedding space.
 *
 * If the paragraph has a heading (a section title above it), we prepend that
 * for better retrieval context: a paragraph about "the test for negligence"
 * matches "negligence test" queries better when the section heading is present.
 */
function buildEmbeddableText(p: ParagraphFromDB): string {
  const parts: string[] = [];

  if (p.heading) parts.push(p.heading);
  parts.push(p.text);

  if (p.subItems && p.subItems.length > 0) {
    for (const sub of p.subItems) {
      parts.push(`(${sub.number}) ${sub.text}`);
    }
  }

  return parts.join('\n').trim();
}

/**
 * Build a SHORT, terminal-friendly error description.
 *
 * We deliberately do NOT pass the raw error object to console.error because
 * Postgres errors carry the full row being inserted as a "parameters" field —
 * and our rows include 1024-dimensional embedding vectors. Logging the raw
 * error would dump tens of thousands of floats to the terminal per error,
 * making the log unreadable and the terminal unresponsive.
 */
function compactErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    // Trim very long messages (some Postgres errors are paragraphs long).
    const msg = err.message.length > 300 ? err.message.slice(0, 300) + '…' : err.message;
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
    // Same compact-message principle here: never dump the full error object.
    console.error('\n[fatal error]', compactErrorMessage(err));
    process.exit(1);
  });
