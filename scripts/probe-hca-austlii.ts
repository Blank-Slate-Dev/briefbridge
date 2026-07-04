// scripts/probe-hca-austlii.ts
//
// THROWAWAY PROBE — not part of the pipeline. Its only job is to capture
// real AustLII High Court HTML so we can write the parser + discovery
// against actual markup (not guesses), exactly how the NSW parser was built.
//
// Uses the SAME Playwright pattern as enumerate-nsw-acts.ts (proven to get
// past AustLII's 403-to-scripts bot detection on this machine).
//
// What it does:
//   1. Loads an HCA year-index page (lists all HCA cases for a year) and
//      dumps its HTML + a structural summary (what the case links look like).
//   2. Loads one individual HCA judgment page and dumps its HTML + summary
//      (headings, metadata blocks, paragraph markup).
//
// Output: scripts/output/hca-probe-index.html
//         scripts/output/hca-probe-judgment.html
//         + console summary of structure.
//
// Run:
//   npx tsx scripts/probe-hca-austlii.ts
//
// AustLII HCA locations (databases):
//   Year index (2024):  https://www.austlii.edu.au/cgi-bin/viewtoc/au/cases/cth/HCA/2024/
//   A judgment:         resolved from the first link found on that index page.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const OUT_DIR = join(process.cwd(), 'scripts', 'output');

// AustLII HCA year-index (table of contents) for a recent year.
const INDEX_URL =
  'https://www.austlii.edu.au/cgi-bin/viewtoc/au/cases/cth/HCA/2024/';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function loadHtml(url: string): Promise<string> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ userAgent: UA });
    console.error(`[probe] loading ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // AustLII pages are static server HTML; domcontentloaded is enough.
    const html = await page.content();
    return html;
  } finally {
    await browser.close();
  }
}

function summariseIndex(html: string): void {
  console.error('\n========== INDEX PAGE STRUCTURE ==========');
  console.error(`total bytes: ${html.length.toLocaleString()}`);

  // Find anchors that look like judgment links. AustLII case URLs typically
  // look like /cgi-bin/viewdoc/au/cases/cth/HCA/2024/1.html or
  // /au/cases/cth/HCA/2024/1.html
  const linkRe = /href="([^"]*\/au\/cases\/cth\/HCA\/\d{4}\/[^"]+)"/gi;
  const links = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    links.add(m[1]);
  }
  console.error(`HCA case-like links found: ${links.size}`);
  console.error('first 10 links:');
  [...links].slice(0, 10).forEach((l) => console.error(`  ${l}`));

  // Print a small slice of HTML around the first case link so we can see the
  // surrounding markup (case name text, list structure).
  const firstLink = [...links][0];
  if (firstLink) {
    const idx = html.indexOf(firstLink);
    const slice = html.slice(Math.max(0, idx - 200), idx + 300);
    console.error('\nmarkup around first case link:');
    console.error(slice.replace(/\s+/g, ' '));
  }
}

function summariseJudgment(html: string, url: string): void {
  console.error('\n========== JUDGMENT PAGE STRUCTURE ==========');
  console.error(`url: ${url}`);
  console.error(`total bytes: ${html.length.toLocaleString()}`);

  // Title
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  console.error(`<title>: ${titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '(none)'}`);

  // Headings — what structural markup exists?
  for (const tag of ['h1', 'h2', 'h3']) {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
    const heads: string[] = [];
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(html)) !== null && heads.length < 8) {
      heads.push(mm[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
    }
    console.error(`<${tag}> count-sample: ${heads.length ? heads.join(' | ') : '(none)'}`);
  }

  // Paragraph markup — AustLII often uses numbered paragraphs. Look for
  // common patterns: <p class="...">, ordered lists, or numbered spans.
  const pClassMatch = html.match(/<p\s+class="([^"]+)"/i);
  console.error(`first <p class>: ${pClassMatch ? pClassMatch[1] : '(none)'}`);

  const olMatch = html.match(/<ol[^>]*>/i);
  console.error(`has <ol>: ${olMatch ? 'yes — ' + olMatch[0] : 'no'}`);

  // Look for the paragraph-number convention: AustLII HCA judgments usually
  // number paragraphs like "1." or with anchors id="para1" or similar.
  const paraAnchor = html.match(/id="(para\d+|p\d+|_\d+)"/i);
  console.error(`para anchor pattern: ${paraAnchor ? paraAnchor[1] : '(none found)'}`);

  // Print a slice of the body where the judgment text likely starts, to
  // eyeball the paragraph markup.
  const bodyStart = html.search(/<p[^>]*>\s*1[\.\s]/i);
  if (bodyStart > -1) {
    console.error('\nmarkup around what looks like paragraph 1:');
    console.error(html.slice(bodyStart, bodyStart + 500).replace(/\s+/g, ' '));
  }
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  // 1. Index page.
  const indexHtml = await loadHtml(INDEX_URL);
  await writeFile(join(OUT_DIR, 'hca-probe-index.html'), indexHtml, 'utf8');
  console.error(`[probe] wrote hca-probe-index.html`);
  summariseIndex(indexHtml);

  // 2. First judgment link from the index.
  const linkRe = /href="([^"]*\/au\/cases\/cth\/HCA\/\d{4}\/[^"]+\.html)"/i;
  const linkMatch = indexHtml.match(linkRe);
  if (!linkMatch) {
    console.error(
      '\n[probe] Could not find a judgment link on the index page. ' +
        'The index HTML is saved — inspect hca-probe-index.html to find the link pattern.',
    );
    return;
  }
  let judgmentUrl = linkMatch[1];
  if (!judgmentUrl.startsWith('http')) {
    judgmentUrl = new URL(judgmentUrl, 'https://www.austlii.edu.au').href;
  }

  const judgmentHtml = await loadHtml(judgmentUrl);
  await writeFile(join(OUT_DIR, 'hca-probe-judgment.html'), judgmentHtml, 'utf8');
  console.error(`[probe] wrote hca-probe-judgment.html`);
  summariseJudgment(judgmentHtml, judgmentUrl);

  console.error('\n[probe] DONE. Two HTML files saved in scripts/output/.');
  console.error('[probe] Share the console summary above so the parser can be');
  console.error('[probe] written against the real markup.');
}

main().catch((err) => {
  console.error('[probe] fatal:', err);
  process.exit(1);
});