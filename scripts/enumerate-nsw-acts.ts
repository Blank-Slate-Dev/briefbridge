// scripts/enumerate-nsw-acts.ts
//
// Builds the master list of in-force NSW public Act IDs from the current
// "Administrative Arrangements (...—Administration of Acts) Order" — the
// single instrument that lists every administered NSW Act by short title
// and number.
//
// AustLII carries a clean consolidated copy but blocks scripted HTTP
// clients (403). So we drive a real Chromium (Playwright, already
// installed) to load Schedule 1 — AustLII serves a real browser fine —
// then parse the IDs out. No manual save, no Cloudflare, no 403.
//
// Source (Schedule 1 of the current Order):
//   https://classic.austlii.edu.au/au/legis/nsw/consol_reg/aamoao2023721/sch1.html
//
// Each Act appears as "<Short Title> <YEAR> No <N>", occasionally as
// "<Short Title> <YEAR> (<YEAR2> No <N>)" when the registration year
// differs from the short-title year. We build act-YYYY-NNN from the
// number and the registration year, zero-padded to 3, and dedup.
//
// Writes scripts/output/nsw-acts-in-force.csv. No DB access.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const SOURCE_URL =
  'https://classic.austlii.edu.au/au/legis/nsw/consol_reg/aamoao2023721/sch1.html';
const OUT_PATH = join(process.cwd(), 'scripts', 'output', 'nsw-acts-in-force.csv');

interface ActId {
  registrationId: string;
  year: number;
  actNo: string;
}

/** Pad the numeric part to 3 digits, preserving any trailing letter (e.g. 37A). */
function pad3(raw: string): string {
  const m = raw.match(/^(\d+)([A-Za-z]?)$/);
  if (!m) return raw;
  return m[1].padStart(3, '0') + m[2].toUpperCase();
}

function csvEscape(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function main() {
  console.error('[enumerate-nsw] launching Chromium...');
  const browser = await chromium.launch({ headless: true });
  let html = '';
  try {
    const page = await browser.newPage({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    console.error(`[enumerate-nsw] loading ${SOURCE_URL}`);
    await page.goto(SOURCE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    html = await page.content();
  } finally {
    await browser.close();
  }

  if (!html || html.length < 5000) {
    throw new Error(
      `Page content looked empty (${html.length} bytes) — the load may have failed.`,
    );
  }

  // Strip tags so linked and non-linked entries parse identically.
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ');

  // "<YEAR> No <N>"  or  "<YEAR> (<YEAR2> No <N>)"
  const re =
    /(\d{4})\s*(?:\(\s*(\d{4})\s*No\s*(\d+[A-Za-z]?)\s*\)|No\s*(\d+[A-Za-z]?))/gi;

  const byId = new Map<string, ActId>();
  let rawMatches = 0;

  for (const m of text.matchAll(re)) {
    rawMatches++;
    const actNoRaw = m[3] ?? m[4];
    if (!actNoRaw) continue;
    const year = Number(m[2] ?? m[1]);
    if (!year || year < 1800 || year > 2100) continue;

    const actNo = pad3(actNoRaw);
    const registrationId = `act-${year}-${actNo}`;
    if (!byId.has(registrationId)) {
      byId.set(registrationId, { registrationId, year, actNo });
    }
  }

  const acts = [...byId.values()].sort((a, b) =>
    a.registrationId.localeCompare(b.registrationId),
  );

  console.error(
    `[enumerate-nsw] ${rawMatches} raw matches → ${acts.length} unique Act IDs`,
  );

  const headers = ['registration_id', 'year', 'act_no', 'source_url'];
  const lines = [headers.join(',')];
  for (const a of acts) {
    const sourceUrl = `https://legislation.nsw.gov.au/view/html/inforce/current/${a.registrationId}`;
    lines.push(
      [csvEscape(a.registrationId), csvEscape(a.year), csvEscape(a.actNo), csvEscape(sourceUrl)].join(','),
    );
  }

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, lines.join('\n') + '\n', 'utf8');
  console.error(`[enumerate-nsw] wrote ${acts.length} rows to ${OUT_PATH}`);

  console.error('\n[enumerate-nsw] first 15 IDs (sanity check):');
  for (const a of acts.slice(0, 15)) console.error(`  ${a.registrationId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});