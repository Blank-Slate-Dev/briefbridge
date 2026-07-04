// scripts/dump-hca-case.ts
//
// Fetches one AustLII HCA case via Playwright and saves the HTML to
// scripts/output/ for parser development.
//
// Usage:
//   npx tsx scripts/dump-hca-case.ts --year 2005 --num 1

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const year = argv[argv.indexOf('--year') + 1];
const num = argv[argv.indexOf('--num') + 1];
if (!year || !num) {
  console.error('Usage: npx tsx scripts/dump-hca-case.ts --year 2005 --num 1');
  process.exit(1);
}

const url = `https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/${year}/${num}.html`;

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    console.error(`[dump] loading ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const html = await page.content();
    const outDir = join(process.cwd(), 'scripts', 'output');
    await mkdir(outDir, { recursive: true });
    const outPath = join(outDir, `hca-${year}-${num}.html`);
    await writeFile(outPath, html, 'utf8');
    console.error(`[dump] wrote ${html.length.toLocaleString()} bytes to ${outPath}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });