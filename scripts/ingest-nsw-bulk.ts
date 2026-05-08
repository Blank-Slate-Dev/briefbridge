// scripts/ingest-nsw-bulk.ts
//
// Bulk ingestion orchestrator for NSW Caselaw.
//
// Walks through search/browse result pages, extracts judgment URLs, and
// fetches+parses+stores each one — skipping those we already have or that
// have failed too many times recently.
//
// Usage:
//   npm run ingest:bulk -- --court NSWSC --year-from 2024 --year-to 2026
//   npm run ingest:bulk -- --court NSWSC --year-from 2026 --limit 50
//   npm run ingest:bulk -- --browse-url "https://www.caselaw.nsw.gov.au/search/advanced?courts=...&startDate=01/01/2026"
//   npm run ingest:bulk -- --court NSWSC --year-from 2026 --year-to 2026 --dry-run
//
// Flags:
//   --court <code>      Court code (NSWSC, NSWCA, NSWCCA, NSWLEC, etc.)
//                       See COURT_IDS map below for supported courts.
//   --year-from <year>  Earliest year to include (inclusive).
//   --year-to <year>    Latest year to include (inclusive). Defaults to year-from.
//   --browse-url <url>  Use this exact URL instead of building one from --court/--year.
//                       Required if you want to use filters not covered by the flags
//                       (e.g. tribunals, catchwords, party names).
//   --limit <n>         Stop after processing this many judgments. Useful for testing.
//   --delay <seconds>   Seconds to wait between requests. Default: 5.
//   --dry-run           List the URLs that WOULD be fetched, without fetching them.
//                       Lets you sanity-check the URL discovery before running.
//   --dump-list-html    Save the first list page's HTML to /tmp for parser debugging.
//
// Polite scraping:
//   - 5-second default delay between requests (academic norm is 10s; we're a
//     bit faster but well within reasonable for a non-commercial research tool).
//   - Identifying User-Agent so NSW Caselaw can contact us if there's an issue.
//   - Skips URLs we already have (no re-fetching just to find we have it).
//   - Respects suppression flags and "Decision restricted" entries.

import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db, schema } from '../lib/db';
import { parseNswJudgment } from '../lib/parsers/nsw-caselaw';
import { parseListPage, type ListResult } from '../lib/parsers/nsw-caselaw-list';
import {
  findAlreadyIngestedUrls,
  shouldSkipDueToFailures,
  recordAttempt,
} from '../lib/db/ingestion-tracking';

// =============================================================================
// Configuration
// =============================================================================

const USER_AGENT = 'BriefBridge-Ingest/0.1 (oakley@briefbridge.ai)';

/**
 * NSW Caselaw uses 24-character hex IDs as court identifiers in URLs.
 * These are the IDs visible when you tick a checkbox on the advanced search
 * page and look at the URL.
 *
 * To add another court: open advanced search, tick ONLY that court, click
 * Search, copy the courts=... value from the URL, paste it here.
 */
const COURT_IDS: Record<string, string> = {
  NSWSC:    '54a634063004de94513d8281', // Supreme Court
  NSWCA:    '54a634063004de94513d8278', // Court of Appeal
  NSWCCA:   '54a634063004de94513d8279', // Court of Criminal Appeal
  NSWDC:    '54a634063004de94513d827c', // District Court
  NSWLEC:   '54a634063004de94513d8286', // Land and Environment Court (Judges)
  NSWLECC:  '54a634063004de94513d827f', // Land and Environment Court (Commissioners)
  NSWLC:    '54a634063004de94513d8280', // Local Court
  NSWIRC:   '54a634063004de94513d827e', // Industrial Relations Commission (Judges)
  NSWIRCC:  '54a634063004de94513d8285', // Industrial Relations Commission (Commissioners)
  NSWIC:    '54a634063004de94513d828e', // Industrial Court
  NSWChC:   '54a634063004de94513d827a', // Children's Court
  NSWComC:  '54a634063004de94513d827b', // Compensation Court
  NSWDrgC:  '54a634063004de94513d827d', // Drug Court
};

// =============================================================================
// CLI argument parsing
// =============================================================================

interface CliArgs {
  court: string | null;
  yearFrom: number | null;
  yearTo: number | null;
  browseUrl: string | null;
  limit: number | null;
  delaySeconds: number;
  dryRun: boolean;
  dumpListHtml: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    court: null,
    yearFrom: null,
    yearTo: null,
    browseUrl: null,
    limit: null,
    delaySeconds: 5,
    dryRun: false,
    dumpListHtml: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];

    switch (a) {
      case '--court':           args.court = next().toUpperCase(); break;
      case '--year-from':       args.yearFrom = parseInt(next(), 10); break;
      case '--year-to':         args.yearTo = parseInt(next(), 10); break;
      case '--browse-url':      args.browseUrl = next(); break;
      case '--limit':           args.limit = parseInt(next(), 10); break;
      case '--delay':           args.delaySeconds = parseFloat(next()); break;
      case '--dry-run':         args.dryRun = true; break;
      case '--dump-list-html':  args.dumpListHtml = true; break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
      default:
        console.error(`Unknown argument: ${a}`);
        printUsage();
        process.exit(1);
    }
  }

  if (!args.browseUrl && !args.court) {
    console.error('Error: must provide either --court or --browse-url.');
    printUsage();
    process.exit(1);
  }

  if (args.court && !COURT_IDS[args.court]) {
    console.error(`Error: unknown court code "${args.court}".`);
    console.error(`Known courts: ${Object.keys(COURT_IDS).join(', ')}`);
    process.exit(1);
  }

  if (args.yearFrom && !args.yearTo) args.yearTo = args.yearFrom;
  if (args.yearFrom && args.yearTo && args.yearFrom > args.yearTo) {
    console.error('Error: --year-from cannot be greater than --year-to.');
    process.exit(1);
  }

  return args;
}

function printUsage(): void {
  console.log(`
Usage: npm run ingest:bulk -- [flags]

Flags:
  --court <code>       Court code (e.g. NSWSC). See COURT_IDS in this file.
  --year-from <year>   Earliest year to include (inclusive).
  --year-to <year>     Latest year to include (inclusive, defaults to year-from).
  --browse-url <url>   Use this exact list URL instead of building one.
  --limit <n>          Stop after processing this many judgments.
  --delay <seconds>    Seconds between requests (default: 5).
  --dry-run            List discovered URLs without fetching them.
  --dump-list-html     Save the first list page HTML to /tmp for debugging.

Examples:
  npm run ingest:bulk -- --court NSWSC --year-from 2024 --year-to 2026
  npm run ingest:bulk -- --court NSWSC --year-from 2026 --limit 50
  npm run ingest:bulk -- --court NSWSC --year-from 2026 --dry-run
  `.trim());
}

// =============================================================================
// URL construction
//
// NSW Caselaw's /search/advanced endpoint takes form-encoded query parameters.
// The format we observed (post-Update-list click in browser):
//   /search/advanced?courts=<24-char-hex>&_courts=on&startDate=DD/MM/YYYY&endDate=DD/MM/YYYY
//
// The startDate/endDate filter is the way to bound by year — there's no
// `years[]=2026` style parameter on the form despite what the browse page
// looked like.
// =============================================================================

function buildBrowseUrl(args: CliArgs): string {
  if (args.browseUrl) return args.browseUrl;

  const courtId = COURT_IDS[args.court!];
  const params = new URLSearchParams();
  params.set('courts', courtId);
  params.set('_courts', 'on');

  if (args.yearFrom !== null) {
    params.set('startDate', `01/01/${args.yearFrom}`);
  }
  if (args.yearTo !== null) {
    // End of year, inclusive.
    params.set('endDate', `31/12/${args.yearTo}`);
  }

  return `https://www.caselaw.nsw.gov.au/search/advanced?${params.toString()}`;
}

// =============================================================================
// HTTP fetcher with polite delay built in
// =============================================================================

class PoliteFetcher {
  private lastFetchAt: number = 0;

  constructor(private delayMs: number, private userAgent: string) {}

  async fetch(url: string): Promise<{ html: string; status: number; durationMs: number }> {
    // Sleep so that requests are spaced at least delayMs apart.
    const elapsed = Date.now() - this.lastFetchAt;
    if (elapsed < this.delayMs && this.lastFetchAt > 0) {
      await sleep(this.delayMs - elapsed);
    }
    this.lastFetchAt = Date.now();

    const start = Date.now();
    const response = await fetch(url, {
      headers: { 'User-Agent': this.userAgent },
    });
    const html = await response.text();
    const durationMs = Date.now() - start;

    return { html, status: response.status, durationMs };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// =============================================================================
// Single-judgment ingestion (a slimmed copy of the logic from ingest-nsw-single)
// =============================================================================

async function ingestOneJudgment(args: {
  url: string;
  preview: ListResult;
  fetcher: PoliteFetcher;
}): Promise<{ status: 'inserted' | 'updated' | 'unchanged'; durationMs: number }> {
  const { url, fetcher } = args;
  const fetchResult = await fetcher.fetch(url);

  if (fetchResult.status !== 200) {
    throw new HttpError(`HTTP ${fetchResult.status}`, fetchResult.status);
  }

  const parsed = parseNswJudgment(fetchResult.html, url);

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
    source: 'nsw_caselaw',
    sourceUrl: url,
    sourceId: parsed.sourceId,
    ...baseValues,
  });
  return { status: 'inserted', durationMs: fetchResult.durationMs };
}

class HttpError extends Error {
  constructor(message: string, public httpStatus: number) {
    super(message);
  }
}

// =============================================================================
// Main loop
// =============================================================================

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const startUrl = buildBrowseUrl(args);
  const fetcher = new PoliteFetcher(args.delaySeconds * 1000, USER_AGENT);

  console.log(`\n========================================`);
  console.log(`BriefBridge bulk ingestion`);
  console.log(`========================================`);
  console.log(`Start URL:    ${startUrl}`);
  console.log(`Delay:        ${args.delaySeconds}s between requests`);
  console.log(`Limit:        ${args.limit ?? 'none'}`);
  console.log(`Mode:         ${args.dryRun ? 'DRY RUN (no fetches, no inserts)' : 'LIVE'}`);
  console.log(`========================================\n`);

  // -------- Phase 1: walk list pages, collect candidate URLs --------
  console.log('[phase 1] Walking list pages to collect URLs...');

  const allCandidates: ListResult[] = [];
  let nextPage: string | null = startUrl;
  let listPagesFetched = 0;
  let firstPageParsed = false;

  while (nextPage) {
    const fetchResult = await fetcher.fetch(nextPage);
    listPagesFetched++;

    if (fetchResult.status !== 200) {
      throw new Error(`List page ${nextPage} returned HTTP ${fetchResult.status}`);
    }

    if (args.dumpListHtml && !firstPageParsed) {
      const tmpDir = process.env.TEMP || process.env.TMPDIR || '/tmp';
      const dumpPath = path.join(tmpDir, `briefbridge-list-page-${Date.now()}.html`);
      await fs.writeFile(dumpPath, fetchResult.html);
      console.log(`  [debug] First list page HTML dumped to ${dumpPath}`);
    }

    const parsed = parseListPage(fetchResult.html, nextPage);

    if (!firstPageParsed) {
      console.log(`  [info] Total matching results: ${parsed.totalResults ?? 'unknown'}`);
      console.log(`  [info] Page size: ${parsed.results.length}`);
      console.log(`  [info] Total pages: ${parsed.totalPages ?? 'unknown'}\n`);
      firstPageParsed = true;
    }

    if (parsed.results.length === 0 && listPagesFetched === 1) {
      console.error('  [error] First list page had ZERO results. Either:');
      console.error('    1. Your filter is too restrictive (no judgments match)');
      console.error('    2. The list parser failed to find results in the HTML');
      console.error('  Re-run with --dump-list-html and inspect the dumped file.');
      process.exit(1);
    }

    allCandidates.push(...parsed.results);
    console.log(
      `  [list] page ${parsed.currentPage ?? listPagesFetched} fetched ` +
      `(${parsed.results.length} results, ${allCandidates.length} total so far)`,
    );

    if (args.limit !== null && allCandidates.length >= args.limit) {
      allCandidates.length = args.limit;
      console.log(`  [list] Stopping early — hit --limit ${args.limit}`);
      break;
    }

    nextPage = parsed.nextPageUrl;
  }

  console.log(`\n[phase 1] Done. ${allCandidates.length} candidate URLs from ${listPagesFetched} list pages.`);

  // -------- Phase 2: filter out already-ingested + recently-failed --------
  console.log('\n[phase 2] Filtering candidates...');

  const candidateUrls = allCandidates.map((c) => c.sourceUrl);
  const alreadyIngested = await findAlreadyIngestedUrls(candidateUrls);
  console.log(`  [filter] ${alreadyIngested.size} of ${candidateUrls.length} are already in DB.`);

  const restrictedCount = allCandidates.filter((c) => c.isRestricted).length;
  console.log(`  [filter] ${restrictedCount} are "Decision restricted" (will be skipped).`);

  // Check failure history for the URLs we'd actually try.
  const remaining = allCandidates.filter(
    (c) => !alreadyIngested.has(c.sourceUrl) && !c.isRestricted,
  );

  const toFetch: ListResult[] = [];
  let recentlyFailedCount = 0;
  for (const candidate of remaining) {
    if (await shouldSkipDueToFailures(candidate.sourceUrl)) {
      recentlyFailedCount++;
      continue;
    }
    toFetch.push(candidate);
  }
  console.log(`  [filter] ${recentlyFailedCount} skipped due to recent failures.`);
  console.log(`  [filter] ${toFetch.length} remaining to fetch.`);

  if (args.dryRun) {
    console.log('\n[dry-run] Would fetch the following:');
    for (const c of toFetch.slice(0, 20)) {
      console.log(`  ${c.citation ?? '(no citation)'} — ${c.sourceUrl}`);
    }
    if (toFetch.length > 20) {
      console.log(`  ... and ${toFetch.length - 20} more`);
    }
    return;
  }

  if (toFetch.length === 0) {
    console.log('\n[done] Nothing to do — every candidate is already ingested or skipped.');
    return;
  }

  // -------- Phase 3: fetch + ingest each judgment --------
  const estimatedMinutes = Math.ceil((toFetch.length * args.delaySeconds) / 60);
  console.log(`\n[phase 3] Fetching ${toFetch.length} judgments (~${estimatedMinutes} min at ${args.delaySeconds}s delay)...\n`);

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (let i = 0; i < toFetch.length; i++) {
    const candidate = toFetch[i];
    const progress = `[${i + 1}/${toFetch.length}]`;
    const label = candidate.citation ?? candidate.caseName ?? candidate.sourceId;

    try {
      const start = Date.now();
      const result = await ingestOneJudgment({
        url: candidate.sourceUrl,
        preview: candidate,
        fetcher,
      });
      await recordAttempt({
        sourceUrl: candidate.sourceUrl,
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
        sourceUrl: candidate.sourceUrl,
        status: 'failed',
        errorMessage: message,
        httpStatus,
      });
      console.error(`  ${progress} FAILED    ${label} — ${message}`);
    }

    // Progress summary every 25 judgments.
    if ((i + 1) % 25 === 0) {
      console.log(
        `\n  --- progress: ${inserted} inserted, ${updated} updated, ${unchanged} unchanged, ${failed} failed ---\n`,
      );
    }
  }

  // -------- Done --------
  console.log(`\n========================================`);
  console.log(`Ingestion complete.`);
  console.log(`========================================`);
  console.log(`Inserted:  ${inserted}`);
  console.log(`Updated:   ${updated}`);
  console.log(`Unchanged: ${unchanged}`);
  console.log(`Failed:    ${failed}`);
  console.log(`Total:     ${inserted + updated + unchanged + failed}`);
  console.log(`========================================\n`);

  if (failed > 0) {
    console.log(`To retry failed URLs, run the same command again — failed attempts older than 24h will be retried.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n[fatal error]', err);
    process.exit(1);
  });