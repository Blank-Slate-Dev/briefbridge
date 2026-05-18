// scripts/enumerate-cth-acts.ts
//
// Enumerates every in-force Commonwealth principal Act from the Federal
// Register of Legislation, via its OData v4 API. Writes a CSV to
// scripts/output/cth-acts-in-force.csv.
//
// Source: https://api.prod.legislation.gov.au/v1/titles/search(...)
//
// The Federal Register's UI hydrates from this endpoint. It's the same
// data the legislation.gov.au search page displays.
//
// Pagination: $top=100 per page, $skip increments by 100. Stops when a
// page returns fewer than $top results or when we've collected
// @odata.count items.
//
// Safety net: hard cap of 20 pages (2,000 Acts) in case the API
// changes shape or we hit a pagination bug. Today's count is 1,259.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const USER_AGENT =
  'Mozilla/5.0 (compatible; BriefBridge legislation; +https://briefbridge.com)';

const BASE_URL =
  'https://api.prod.legislation.gov.au/v1/titles' +
  `/search(criteria='and(collection(Act),status(InForce),type(Principal))')`;

const QUERY_PARAMS =
  `?$select=id,name,year,number,isInForce,isPrincipal` +
  `&$expand=administeringDepartments,searchContexts($expand=fullTextVersion)` +
  `&$orderby=name asc` +
  `&$count=true` +
  `&$top=${PAGE_SIZE}`;

interface Department {
  id?: string;
  name?: string;
  portfolio?: string;
}

interface FullTextVersion {
  start?: string;            // The compilation date — what we need for fetching
  registeredAt?: string;
  registerId?: string;
  isLatest?: boolean;
}

interface SearchContexts {
  fullTextVersion?: FullTextVersion | null;
}

interface ActRow {
  id: string;
  name: string;
  year?: number;
  number?: number;
  isInForce?: boolean;
  isPrincipal?: boolean;
  administeringDepartments?: Department[];
  searchContexts?: SearchContexts | null;
}

interface ApiResponse {
  '@odata.count': number;
  value: ActRow[];
}

async function fetchPage(skip: number): Promise<ApiResponse> {
  const url = `${BASE_URL}${QUERY_PARAMS}&$skip=${skip}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  return (await res.json()) as ApiResponse;
}

/**
 * CSV escape: wrap in quotes if the value contains a comma, quote, or
 * newline. Escape internal quotes by doubling them.
 */
function csvEscape(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Convert the OData `start` ISO datetime to a YYYY-MM-DD compilation date.
 * E.g. "2026-03-27T13:00:00.000Z" → "2026-03-27".
 *
 * Returns empty string if input is missing or malformed — we'd rather
 * skip the date than corrupt the CSV. The probe will surface the gap.
 */
function compilationDateOf(act: ActRow): string {
  const start = act.searchContexts?.fullTextVersion?.start;
  if (!start) return '';
  const match = start.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

async function main() {
  console.error('[enumerate] Fetching all in-force Cth principal Acts...');

  const allActs: ActRow[] = [];
  let totalCount = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const skip = page * PAGE_SIZE;
    console.error(
      `[enumerate] page ${page + 1} — fetching $skip=${skip}, $top=${PAGE_SIZE}`,
    );

    const response = await fetchPage(skip);

    if (page === 0) {
      totalCount = response['@odata.count'];
      console.error(`[enumerate] @odata.count = ${totalCount.toLocaleString()}`);
    }

    const rows = response.value;
    allActs.push(...rows);

    // Stop conditions: short page, or we've collected the full count.
    if (rows.length < PAGE_SIZE) {
      console.error(
        `[enumerate] page ${page + 1} returned ${rows.length} rows (< ${PAGE_SIZE}) — done.`,
      );
      break;
    }
    if (allActs.length >= totalCount) {
      console.error(
        `[enumerate] collected ${allActs.length.toLocaleString()} >= ${totalCount.toLocaleString()} — done.`,
      );
      break;
    }
  }

  console.error(
    `[enumerate] collected ${allActs.length.toLocaleString()} Acts ` +
      `(expected ${totalCount.toLocaleString()})`,
  );

  if (allActs.length !== totalCount) {
    console.error(
      `[enumerate] WARNING: collected count (${allActs.length}) does not ` +
        `match @odata.count (${totalCount}). Output may be incomplete.`,
    );
  }

  // Build CSV
  const headers = [
    'registration_id',
    'title',
    'year',
    'act_no',
    'portfolio',
    'department',
    'compilation_date',
    'latest_register_id',
    'latest_registered_at',
    'source_url',
  ];

  const lines = [headers.join(',')];
  let missingDateCount = 0;

  for (const act of allActs) {
    const dept = act.administeringDepartments?.[0];
    const portfolio = dept?.portfolio ?? '';
    const department = dept?.name ?? '';

    const ftv = act.searchContexts?.fullTextVersion;
    const latestRegisterId = ftv?.registerId ?? '';
    const latestRegisteredAt = ftv?.registeredAt ?? '';

    const compilationDate = compilationDateOf(act);
    if (!compilationDate) missingDateCount++;

    const sourceUrl = `https://www.legislation.gov.au/${act.id}/latest`;

    const row = [
      csvEscape(act.id),
      csvEscape(act.name),
      csvEscape(act.year),
      csvEscape(act.number),
      csvEscape(portfolio.replace(/\s+/g, ' ').trim()),
      csvEscape(department.replace(/\s+/g, ' ').trim()),
      csvEscape(compilationDate),
      csvEscape(latestRegisterId),
      csvEscape(latestRegisteredAt),
      csvEscape(sourceUrl),
    ];

    lines.push(row.join(','));
  }

  // Write
  const outPath = join(process.cwd(), 'scripts', 'output', 'cth-acts-in-force.csv');
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, lines.join('\n') + '\n', 'utf8');

  console.error(`[enumerate] wrote ${allActs.length.toLocaleString()} rows to:`);
  console.error(`            ${outPath}`);

  if (missingDateCount > 0) {
    console.error(
      `[enumerate] WARNING: ${missingDateCount} Acts missing compilation_date ` +
        `(searchContexts.fullTextVersion.start was null).`,
    );
  }

  // Portfolio breakdown for quick scan
  const byPortfolio = new Map<string, number>();
  for (const act of allActs) {
    const portfolio = act.administeringDepartments?.[0]?.portfolio ?? '(unassigned)';
    const normalised = portfolio.replace(/\s+/g, ' ').trim();
    byPortfolio.set(normalised, (byPortfolio.get(normalised) ?? 0) + 1);
  }

  console.error(`\n[enumerate] portfolio distribution:`);
  const sorted = [...byPortfolio.entries()].sort((a, b) => b[1] - a[1]);
  for (const [portfolio, count] of sorted) {
    console.error(`  ${count.toString().padStart(4)} — ${portfolio}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});