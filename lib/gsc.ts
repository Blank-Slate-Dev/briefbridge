// lib/gsc.ts
//
// Google Search Console API client — pulls search performance data
// (clicks, impressions, CTR, position) for briefbridge.ai.
//
// AUTH: a service account (gsc-reader@…) with access granted to the
// property in Search Console → Settings → Users and permissions. Env:
//   GSC_CLIENT_EMAIL   service account email
//   GSC_PRIVATE_KEY    the JSON key's private_key (one line, literal \n)
//   GSC_SITE_URL       'sc-domain:briefbridge.ai' (domain property form)
//
// DATA LAG: Search Console data is ~2 days behind. Queries default to a
// window ending 2 days ago so the most recent rows aren't half-empty.
//
// All functions return [] on error and log — the dashboard must never
// break because Google is having a moment.

import { google } from 'googleapis';

const SITE_URL = process.env.GSC_SITE_URL ?? 'sc-domain:briefbridge.ai';

export type GscDimension = 'date' | 'page' | 'query' | 'country' | 'device';

export interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;      // 0..1
  position: number;
}

function isConfigured(): boolean {
  return Boolean(process.env.GSC_CLIENT_EMAIL && process.env.GSC_PRIVATE_KEY);
}

function client() {
  const auth = new google.auth.JWT({
    email: process.env.GSC_CLIENT_EMAIL,
    // The key is stored with literal \n sequences in .env; restore them.
    key: process.env.GSC_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  });
  return google.searchconsole({ version: 'v1', auth });
}

/** YYYY-MM-DD, `daysAgo` days before today (UTC-ish; GSC uses PT but the
 *  ±1 day slop is immaterial for trend reporting). */
function isoDaysAgo(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

/**
 * Core query. `dimensions` controls the grouping:
 *   ['date']            → daily trend
 *   ['page']            → top pages
 *   ['query']           → top search queries
 *   ['country']         → geography
 *   ['device']          → device split
 *   ['page','query']    → which query drove which page
 */
export async function gscQuery(options: {
  dimensions: GscDimension[];
  days?: number;      // window length, default 28
  rowLimit?: number;  // default 25
}): Promise<GscRow[]> {
  if (!isConfigured()) return [];

  const days = options.days ?? 28;
  const rowLimit = options.rowLimit ?? 25;

  try {
    const res = await client().searchanalytics.query({
      siteUrl: SITE_URL,
      requestBody: {
        startDate: isoDaysAgo(days + 2),
        endDate: isoDaysAgo(2), // 2-day reporting lag
        dimensions: options.dimensions,
        rowLimit,
      },
    });

    return (res.data.rows ?? []).map((r) => ({
      keys: r.keys ?? [],
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
      ctr: r.ctr ?? 0,
      position: r.position ?? 0,
    }));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      '[gsc] query failed:',
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}

/** Convenience: totals over the window (sum of a date-grouped query). */
export async function gscTotals(days = 28): Promise<{
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}> {
  const rows = await gscQuery({ dimensions: ['date'], days, rowLimit: 1000 });
  const clicks = rows.reduce((n, r) => n + r.clicks, 0);
  const impressions = rows.reduce((n, r) => n + r.impressions, 0);
  const ctr = impressions > 0 ? clicks / impressions : 0;
  const position =
    rows.length > 0
      ? rows.reduce((n, r) => n + r.position, 0) / rows.length
      : 0;
  return { clicks, impressions, ctr, position };
}

export { isConfigured as isGscConfigured };