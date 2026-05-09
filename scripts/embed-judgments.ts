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
//
// Resumability:
//   The script SKIPS judgments that already have embeddings for the current
//   model. If you stop with Ctrl+C and re-run, it picks up where it left off.
//
// Idempotency:
//   Re-running on already-embedded judgments is a no-op (cheap DB query, no
//   API call, no insert).
//
// Cost & rate:
//   Voyage's free tier is generous for our scale (~$10 of usage to embed
//   20,000 judgments). We send 64 paragraphs per request to balance throughput
//   with not flooding their API.

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
// CLI argument parsing
// =============================================================================

interface CliArgs {
  limit: number | null;
  judgmentId: string | null;
  since: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { limit: null, judgmentId: null, since: null };
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

  console.log('========================================');
  console.log('BriefBridge embedding pipeline');
  console.log('========================================');
  console.log(`Model:    ${MODEL}`);
  console.log(`Batch:    ${PARAGRAPHS_PER_BATCH} paragraphs per Voyage request`);
  console.log(`Min len:  ${MIN_PARAGRAPH_CHARS} chars (shorter paragraphs skipped)`);
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
  const startTime = Date.now();

  for (let i = 0; i < judgments.length; i++) {
    const judgment = judgments[i];
    const progress = `[${i + 1}/${judgments.length}]`;
    const label = judgment.citation ?? judgment.id.slice(0, 8);

    try {
      const result = await embedOneJudgment(judgment);
      totalEmbedded += result.embedded;
      totalSkipped += result.skipped;
      totalTokens += result.tokens;
      totalApiCalls += result.apiCalls;
      console.log(
        `  ${progress} ${label} — ${result.embedded} embedded, ${result.skipped} skipped`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ${progress} ${label} — ERROR: ${message}`);
      // Continue on error rather than aborting the whole run.
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
  // Voyage's voyage-law-2 is ~$0.12 per million tokens.
  const cost = (totalTokens / 1_000_000) * 0.12;
  console.log(`Est. cost:  ~$${cost.toFixed(2)} USD`);
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

async function embedOneJudgment(judgment: {
  id: string;
  citation: string | null;
  paragraphs: unknown;
  paragraphCount: number | null;
}): Promise<EmbedJudgmentResult> {
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

  for (const batch of batches) {
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
  }

  // Insert all rows in chunks of 100 to avoid huge single inserts.
  const INSERT_CHUNK = 100;
  for (let i = 0; i < rowsToInsert.length; i += INSERT_CHUNK) {
    const chunk = rowsToInsert.slice(i, i + INSERT_CHUNK);
    await db.insert(schema.judgmentEmbeddings).values(chunk);
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

// =============================================================================
// Run it
// =============================================================================

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n[fatal error]', err);
    process.exit(1);
  });
