// lib/db/ingestion-tracking.ts
//
// Helpers that the bulk ingester uses to decide what to do with each URL it
// encounters: fetch it, skip it (already have it), or skip it (recently failed).
//
// Three core questions this module answers:
//   1. Is this URL already in the judgments table?  → isAlreadyIngested
//   2. Has this URL recently failed enough times to skip?  → shouldSkipDueToFailures
//   3. Record what happened with this attempt.  → recordAttempt
//
// All functions are safe to call repeatedly; the ingester does not need to
// batch or transaction-wrap them.

import { eq, and, gte, sql, inArray } from 'drizzle-orm';
import { db, schema } from './index';

const FAILURE_LOOKBACK_HOURS = 24;
const MAX_RECENT_FAILURES = 3;

/**
 * Is this URL already in the judgments table?
 *
 * Returns true if a row exists. We do NOT check content_hash here — even if the
 * stored content is stale, "already ingested" means "we have a row for this URL"
 * and the caller decides whether to re-fetch for freshness.
 *
 * The bulk ingester uses this to skip the (slow, polite-pause-required) fetch
 * step entirely when we already have the record.
 */
export async function isAlreadyIngested(sourceUrl: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.judgments.id })
    .from(schema.judgments)
    .where(eq(schema.judgments.sourceUrl, sourceUrl))
    .limit(1);
  return rows.length > 0;
}

/**
 * Bulk version: given an array of URLs, returns the subset that ARE already
 * ingested. Saves N round-trips when we just got 200 URLs from a list page.
 */
export async function findAlreadyIngestedUrls(sourceUrls: string[]): Promise<Set<string>> {
  if (sourceUrls.length === 0) return new Set();
  const rows = await db
    .select({ sourceUrl: schema.judgments.sourceUrl })
    .from(schema.judgments)
    .where(inArray(schema.judgments.sourceUrl, sourceUrls));
  return new Set(rows.map((r) => r.sourceUrl));
}

/**
 * Should we skip this URL because it's failed too many times recently?
 *
 * "Recently" = the last 24 hours. "Too many" = 3+ failures.
 * This prevents us from hammering broken URLs (server errors, parse bugs,
 * suppressed decisions, etc.) on every run.
 *
 * The 24-hour window means transient failures naturally get retried later —
 * if NSW Caselaw was down for an hour and we logged 3 failures, we'll try
 * again the next day. That's the right behaviour.
 */
export async function shouldSkipDueToFailures(sourceUrl: string): Promise<boolean> {
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
  const failureCount = rows[0]?.count ?? 0;
  return failureCount >= MAX_RECENT_FAILURES;
}

/**
 * Records the outcome of an ingestion attempt.
 *
 * Always inserts a new row — we keep the full history for auditing and for
 * the failure-count logic above.
 */
export async function recordAttempt(args: {
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

/**
 * For monitoring/debugging — gets a summary of recent ingestion activity.
 */
export async function getIngestionStats(lookbackHours: number = 24): Promise<{
  success: number;
  failed: number;
  skipped: number;
  totalAttempts: number;
}> {
  const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
  const rows = await db
    .select({
      status: schema.ingestionAttempts.status,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.ingestionAttempts)
    .where(gte(schema.ingestionAttempts.attemptedAt, cutoff))
    .groupBy(schema.ingestionAttempts.status);

  const stats = { success: 0, failed: 0, skipped: 0, totalAttempts: 0 };
  for (const r of rows) {
    if (r.status === 'success') stats.success = r.count;
    else if (r.status === 'failed') stats.failed = r.count;
    else if (r.status === 'skipped') stats.skipped = r.count;
    stats.totalAttempts += r.count;
  }
  return stats;
}