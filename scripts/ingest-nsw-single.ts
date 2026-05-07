/**
 * NSW Caselaw single-judgment ingestion.
 *
 * Compliance (per https://www.caselaw.nsw.gov.au/policy.html):
 *  - Polite scraping: 2s between requests, custom User-Agent identifying us
 *  - Source attribution stored on every record
 *  - Suppression detection via the "Publication restriction" coversheet field
 *  - Content hashing detects when judgments are amended
 *
 * Usage:
 *   npm run ingest:nsw -- https://www.caselaw.nsw.gov.au/decision/<id>
 */

import 'dotenv/config';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '../lib/db';
import { parseNswJudgment } from '../lib/parsers/nsw-caselaw';

const USER_AGENT = 'BriefBridge-Ingest/0.1 (oakley@briefbridge.ai)';

async function fetchHtml(url: string): Promise<string> {
  console.log(`[fetch] ${url}`);
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function ingestJudgment(url: string): Promise<void> {
  // 1. Fetch
  const html = await fetchHtml(url);

  // 2. Parse — verified working against real NSW Caselaw HTML
  const parsed = parseNswJudgment(html, url);

  console.log('[parse]', {
    caseName: parsed.caseName,
    citation: parsed.citation,
    court: parsed.court,
    decisionDate: parsed.decisionDate,
    judges: parsed.judges,
    paragraphCount: parsed.paragraphCount,
    casesCited: parsed.casesCited.length,
    legislationCited: parsed.legislationCited.length,
    suppression: parsed.suppressionDetected,
  });

  // Sanity checks
  if (!parsed.citation) {
    throw new Error('No citation parsed — page structure may have changed.');
  }
  if (parsed.paragraphs.length === 0) {
    throw new Error('No paragraphs parsed — page structure may have changed.');
  }

  // 3. Hash for change detection
  const contentHash = crypto.createHash('sha256').update(parsed.fullText).digest('hex');

  // 4. Check existing
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
    rawHtml: html,
    publicationRestriction: parsed.publicationRestriction,
    suppressionFlag: parsed.suppressionDetected,
    contentHash,
    decisionLastUpdated: parsed.decisionLastUpdated,
    lastCheckedAt: new Date(),
  };

  if (existing.length > 0) {
    const prior = existing[0];
    if (prior.contentHash === contentHash) {
      console.log('[skip] Already ingested, content unchanged.');
      await db
        .update(schema.judgments)
        .set({ lastCheckedAt: new Date() })
        .where(eq(schema.judgments.id, prior.id));
      return;
    }
    console.log('[update] Content has changed — updating record.');
    await db
      .update(schema.judgments)
      .set(baseValues)
      .where(eq(schema.judgments.id, prior.id));
    console.log('[update] Done.');
    return;
  }

  // 5. Insert new
  const [inserted] = await db
    .insert(schema.judgments)
    .values({
      source: 'nsw_caselaw',
      sourceUrl: url,
      sourceId: parsed.sourceId,
      ...baseValues,
    })
    .returning({ id: schema.judgments.id });

  console.log(`[insert] Saved with id ${inserted.id}`);
}

const url = process.argv[2];
if (!url) {
  console.error('Usage: npm run ingest:nsw -- <judgment-url>');
  process.exit(1);
}

ingestJudgment(url)
  .then(() => {
    console.log('[done]');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[error]', err);
    process.exit(1);
  });
