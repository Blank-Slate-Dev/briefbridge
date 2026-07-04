// scripts/ingest-hca-bulk.ts
//
// Bulk ingestion orchestrator for High Court of Australia judgments from
// AustLII. Mirrors scripts/ingest-nsw-bulk.ts, with two deliberate
// differences:
//
//   1. PLAYWRIGHT FETCHER, NOT plain fetch. AustLII returns 403 to scripted
//      HTTP clients; a real Chromium (same pattern as enumerate-nsw-acts.ts
//      and the probe) is served normally. One browser is launched for the
//      whole run and reused for every page.
//
//   2. PRIVILEGED DB CONNECTION (lib/db/script-db). lib/db/ingestion-tracking
//      imports the restricted app connection (lib/db), which under RLS sees
//      ZERO rows from a script context — dedup would silently break and
//      inserts would fail. So this script inlines the same dedup/attempt
//      logic against script-db instead.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/ingest-hca-bulk.ts --year-from 2020 --year-to 2026 --dry-run
//   npx tsx --env-file=.env.local scripts/ingest-hca-bulk.ts --year-from 2020 --year-to 2026
//   npx tsx --env-file=.env.local scripts/ingest-hca-bulk.ts --year-from 1948 --year-to 2026 --delay 5
//
// Flags:
//   --year-from <year>   Earliest year (inclusive). Required.
//   --year-to <year>     Latest year (inclusive). Defaults to year-from.
//   --limit <n>          Stop after processing this many judgments.
//   --delay <seconds>    Seconds between AustLII requests. Default: 5.
//                        BE POLITE — AustLII blocks aggressive clients.
//   --dry-run            Discover + list what WOULD be fetched, no fetches of
//                        judgment pages, no DB writes.
//
// Resumability: skips URLs already in the judgments table; failed URLs are
// recorded and skipped after 3 failures in 24h (same policy as NSW). Ctrl+C
// and re-run any time.
//
// AFTER INGESTION: new judgments are NOT embedded. Run:
//   npx tsx --env-file=.env.local scripts/embed-judgments.ts --fast

import 'dotenv/config';
import crypto from 'node:crypto';
import { eq, and, gte, sql, inArray } from 'drizzle-orm';
import { chromium } from 'playwright';
import { db, schema } from '../lib/db/script-db';
import { parseHcaJudgment } from '../lib/parsers/hca-austlii';
import {
  parseHcaIndexPage,
  buildHcaIndexUrl,
  type HcaListResult,
} from '../lib/parsers/hca-austlii-list';

// =============================================================================
// Configuration
// =============================================================================

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const SOURCE_NAME = 'hca_austlii';

const FAILURE_LOOKBACK_HOURS = 24;
const MAX_RECENT_FAILURES = 3;

// =============================================================================
// CLI
// =============================================================================

interface CliArgs {
  yearFrom: number;
  yearTo: number;
  limit: number | null;
  delaySeconds: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let yearFrom: number | null = null;
  let yearTo: number | null = null;
  let limit: number | null = null;
  let delaySeconds = 5;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--year-from': yearFrom = parseInt(argv[++i], 10); break;
      case '--year-to':   yearTo = parseInt(argv[++i], 10); break;
      case '--limit':     limit = parseInt(argv[++i], 10); break;
      case '--delay':     delaySeconds = parseFloat(argv[++i]); break;
      case '--dry-run':   dryRun = true; break;
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

  if (yearFrom === null) {
    console.error('Error: --year-from is required.');
    printUsage();
    process.exit(1);
  }
  if (yearTo === null) yearTo = yearFrom;
  if (yearFrom > yearTo) {
    console.error('Error: --year-from cannot be greater than --year-to.');
    process.exit(1);
  }
  const thisYear = new Date().getFullYear();
  if (yearFrom < 1903 || yearTo > thisYear) {
    console.error(`Error: years must be within 1903..${thisYear} (HCA on AustLII).`);
    process.exit(1);
  }

  return { yearFrom, yearTo, limit, delaySeconds, dryRun };
}

function printUsage(): void {
  console.log(`
Usage: npx tsx --env-file=.env.local scripts/ingest-hca-bulk.ts [flags]

Flags:
  --year-from <year>   Earliest year (inclusive). Required.
  --year-to <year>     Latest year (inclusive). Defaults to year-from.
  --limit <n>          Stop after processing this many judgments.
  --delay <seconds>    Seconds between requests (default: 5).
  --dry-run            List what would be fetched; no fetches, no DB writes.

Examples:
  npx tsx --env-file=.env.local scripts/ingest-hca-bulk.ts --year-from 2024 --dry-run
  npx tsx --env-file=.env.local scripts/ingest-hca-bulk.ts --year-from 2020 --year-to 2026
`.trim());
}

// =============================================================================
// Playwright fetcher (polite, one browser for the whole run)
// =============================================================================

class PlaywrightFetcher {
  private lastFetchAt = 0;

  constructor(private delayMs: number) {}

  async init(): Promise<void> {
    // No persistent browser. AustLII 403s the second and subsequent
    // navigations within one browser session (verified: session-reusing
    // fetches got "first OK, rest 403"; the test harness's fresh-browser-
    // per-fetch pattern got zero 403s across 5 sequential cases). So we
    // launch a fresh Chromium per fetch. ~1-2s overhead per fetch, which
    // sits inside the politeness delay anyway.
  }

  async fetch(url: string): Promise<{ html: string; status: number; durationMs: number }> {
    const elapsed = Date.now() - this.lastFetchAt;
    if (elapsed < this.delayMs && this.lastFetchAt > 0) {
      await sleep(this.delayMs - elapsed);
    }
    this.lastFetchAt = Date.now();

    const start = Date.now();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ userAgent: UA });
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      const html = await page.content();
      return {
        html,
        status: response?.status() ?? 0,
        durationMs: Date.now() - start,
      };
    } finally {
      await browser.close();
    }
  }

  async close(): Promise<void> {
    // Nothing persistent to close.
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// =============================================================================
// Dedup + attempt tracking (inlined against script-db — see header)
// =============================================================================

async function findAlreadyIngestedUrls(sourceUrls: string[]): Promise<Set<string>> {
  if (sourceUrls.length === 0) return new Set();
  const rows = await db
    .select({ sourceUrl: schema.judgments.sourceUrl })
    .from(schema.judgments)
    .where(inArray(schema.judgments.sourceUrl, sourceUrls));
  return new Set(rows.map((r) => r.sourceUrl));
}

async function shouldSkipDueToFailures(sourceUrl: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - FAILURE_LOOKBACK_HOURS * 60 * 60 * 1000);
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.ingestionAttempts)
    .where(
      and(
        eq(schema.ingestionAttempts.sourceUrl, sourceUrl),
        eq(schema.ingestionAttempts.status, 'failed'),
        gte(schema.ingestionAttempts.attemptedAt, cutoff),
      ),
    );
  return (rows[0]?.count ?? 0) >= MAX_RECENT_FAILURES;
}

async function recordAttempt(args: {
  sourceUrl: string;
  status: 'success' | 'failed' | 'skipped';
  errorMessage?: string;
  httpStatus?: number;
  durationMs?: number;
}): Promise<void> {
  await db.insert(schema.ingestionAttempts).values({
    sourceUrl: args.sourceUrl,
    status: args.status,
    errorMessage: args.errorMessage ?? null,
    httpStatus: args.httpStatus ?? null,
    durationMs: args.durationMs ?? null,
  });
}

// =============================================================================
// Single-judgment ingestion (mirrors ingest-nsw-bulk's ingestOneJudgment)
// =============================================================================

class HttpError extends Error {
  constructor(message: string, public httpStatus: number) {
    super(message);
  }
}

async function ingestOneJudgment(args: {
  url: string;
  fetcher: PlaywrightFetcher;
}): Promise<{ status: 'inserted' | 'updated' | 'unchanged'; durationMs: number }> {
  const { url, fetcher } = args;
  const fetchResult = await fetcher.fetch(url);

  if (fetchResult.status !== 200) {
    throw new HttpError(`HTTP ${fetchResult.status}`, fetchResult.status);
  }

  const parsed = parseHcaJudgment(fetchResult.html, url);

  if (!parsed.citation || parsed.paragraphs.length === 0) {
    throw new Error('Parser returned no citation or no paragraphs — page may be malformed.');
  }

  const contentHash = crypto.createHash('sha256').update(parsed.fullText).digest('hex');

  const existing = await db
    .select()
    .from(schema.judgments)
    .where(eq(schema.judgments.sourceUrl, url))
    .limit(1);

  const baseValues = {
    citation: parsed.citation,
    caseName: parsed.caseName,
    court: parsed.court,
    jurisdiction: parsed.jurisdiction,
    decisionDate: parsed.decisionDate,
    hearingDates: parsed.hearingDates,
    judges: parsed.judges,
    parties: parsed.parties,
    representation: parsed.representation,
    fileNumbers: parsed.fileNumbers,
    category: parsed.category,
    catchwords: parsed.catchwords,
    decisionSummary: parsed.decisionSummary,
    casesCited: parsed.casesCited,
    legislationCited: parsed.legislationCited,
    paragraphs: parsed.paragraphs,
    fullText: parsed.fullText,
    paragraphCount: parsed.paragraphCount,
    rawHtml: fetchResult.html,
    publicationRestriction: parsed.publicationRestriction,
    suppressionFlag: parsed.suppressionDetected,
    contentHash,
    decisionLastUpdated: parsed.decisionLastUpdated,
    lastCheckedAt: new Date(),
  };

  if (existing.length > 0) {
    const prior = existing[0];
    if (prior.contentHash === contentHash) {
      await db
        .update(schema.judgments)
        .set({ lastCheckedAt: new Date() })
        .where(eq(schema.judgments.id, prior.id));
      return { status: 'unchanged', durationMs: fetchResult.durationMs };
    }
    await db
      .update(schema.judgments)
      .set(baseValues)
      .where(eq(schema.judgments.id, prior.id));
    return { status: 'updated', durationMs: fetchResult.durationMs };
  }

  await db.insert(schema.judgments).values({
    source: SOURCE_NAME,
    sourceUrl: url,
    sourceId: parsed.sourceId,
    ...baseValues,
  });
  return { status: 'inserted', durationMs: fetchResult.durationMs };
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const fetcher = new PlaywrightFetcher(args.delaySeconds * 1000);
  await fetcher.init();

  console.log(`\n========================================`);
  console.log(`BriefBridge HCA bulk ingestion (AustLII)`);
  console.log(`========================================`);
  console.log(`Years:   ${args.yearFrom}..${args.yearTo}`);
  console.log(`Delay:   ${args.delaySeconds}s between requests`);
  console.log(`Limit:   ${args.limit ?? 'none'}`);
  console.log(`Mode:    ${args.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`========================================\n`);

  try {
    // -------- Phase 1: discover judgment URLs from year indexes --------
    console.log('[phase 1] Discovering judgments from year indexes...');
    const allCandidates: HcaListResult[] = [];

    for (let year = args.yearFrom; year <= args.yearTo; year++) {
      const indexUrl = buildHcaIndexUrl(year);
      const res = await fetcher.fetch(indexUrl);
      if (res.status !== 200) {
        console.error(`  [${year}] index returned HTTP ${res.status} — skipping year`);
        continue;
      }
      const parsed = parseHcaIndexPage(res.html, indexUrl);
      console.log(`  [${year}] ${parsed.results.length} judgments listed`);
      allCandidates.push(...parsed.results);

      if (args.limit !== null && allCandidates.length >= args.limit) break;
    }

    if (args.limit !== null && allCandidates.length > args.limit) {
      allCandidates.length = args.limit;
    }

    console.log(`\n[phase 1] Done. ${allCandidates.length} candidates.\n`);

    // -------- Phase 2: filter --------
    console.log('[phase 2] Filtering candidates...');
    const urls = allCandidates.map((c) => c.sourceUrl);
    const already = await findAlreadyIngestedUrls(urls);
    console.log(`  [filter] ${already.size} of ${urls.length} already in DB.`);

    const remaining = allCandidates.filter((c) => !already.has(c.sourceUrl));
    const toFetch: HcaListResult[] = [];
    let recentlyFailed = 0;
    for (const c of remaining) {
      if (await shouldSkipDueToFailures(c.sourceUrl)) {
        recentlyFailed++;
        continue;
      }
      toFetch.push(c);
    }
    console.log(`  [filter] ${recentlyFailed} skipped due to recent failures.`);
    console.log(`  [filter] ${toFetch.length} to fetch.`);

    if (args.dryRun) {
      console.log('\n[dry-run] Would fetch:');
      for (const c of toFetch.slice(0, 20)) {
        console.log(`  ${c.citation ?? c.sourceId} — ${c.sourceUrl}`);
      }
      if (toFetch.length > 20) console.log(`  ... and ${toFetch.length - 20} more`);
      return;
    }

    if (toFetch.length === 0) {
      console.log('\n[done] Nothing to do.');
      return;
    }

    // -------- Phase 3: fetch + ingest --------
    const estMinutes = Math.ceil((toFetch.length * args.delaySeconds) / 60);
    console.log(`\n[phase 3] Ingesting ${toFetch.length} judgments (~${estMinutes} min at ${args.delaySeconds}s delay)...\n`);

    let inserted = 0, updated = 0, unchanged = 0, failed = 0;

    for (let i = 0; i < toFetch.length; i++) {
      const c = toFetch[i];
      const progress = `[${i + 1}/${toFetch.length}]`;
      const label = c.citation ?? c.sourceId;

      try {
        const start = Date.now();
        const result = await ingestOneJudgment({ url: c.sourceUrl, fetcher });
        await recordAttempt({
          sourceUrl: c.sourceUrl,
          status: 'success',
          durationMs: Date.now() - start,
        });
        if (result.status === 'inserted') inserted++;
        else if (result.status === 'updated') updated++;
        else unchanged++;
        console.log(`  ${progress} ${result.status.padEnd(9)} ${label}`);
      } catch (err) {
        failed++;
        const message = err instanceof Error ? err.message : String(err);
        const httpStatus = err instanceof HttpError ? err.httpStatus : undefined;
        await recordAttempt({
          sourceUrl: c.sourceUrl,
          status: 'failed',
          errorMessage: message,
          httpStatus,
        });
        console.error(`  ${progress} FAILED    ${label} — ${message}`);
      }

      if ((i + 1) % 25 === 0) {
        console.log(`\n  --- progress: ${inserted} inserted, ${updated} updated, ${unchanged} unchanged, ${failed} failed ---\n`);
      }
    }

    console.log(`\n========================================`);
    console.log(`HCA ingestion complete.`);
    console.log(`========================================`);
    console.log(`Inserted:  ${inserted}`);
    console.log(`Updated:   ${updated}`);
    console.log(`Unchanged: ${unchanged}`);
    console.log(`Failed:    ${failed}`);
    console.log(`========================================`);
    console.log(`\nREMINDER: new judgments are NOT yet embedded. Run:`);
    console.log(`  npx tsx --env-file=.env.local scripts/embed-judgments.ts --fast\n`);
  } finally {
    await fetcher.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n[fatal error]', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });