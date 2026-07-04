// scripts/test-hca-parser.ts
//
// Test harness for the HCA parser. Fetches real HCA judgments from AustLII
// via Playwright and prints the parsed output, so we can verify the parser
// against varied cases (modern/old, single/multi-judgment) BEFORE trusting it
// for bulk ingestion.
//
// Usage:
//   npx tsx scripts/test-hca-parser.ts
//   npx tsx scripts/test-hca-parser.ts --year 2001 --num 30
//   npx tsx scripts/test-hca-parser.ts --url https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/2001/30.html
//
// Prints, per case: coversheet fields, paragraph count + continuity check,
// first/last paragraphs, cited cases/legislation counts. Watch for:
//   - continuity gaps (should be NONE for a clean parse)
//   - empty judges/catchwords/parties (coversheet regex miss on that layout)
//   - paragraphCount of 0 (total parse failure on an old template)

import { chromium } from 'playwright';
import { parseHcaJudgment } from '../lib/parsers/hca-austlii';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Default sample set: a spread of years and case types to stress the parser.
const DEFAULT_URLS = [
  'https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/2024/1.html',  // modern, plurality + dissent
  'https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/2020/5.html',  // recent
  'https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/2010/1.html',  // older
  'https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/2001/1.html',  // old template
  'https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/1998/1.html',  // very old
];

function parseArgs(): string[] {
  const argv = process.argv.slice(2);
  const urlFlag = argv.indexOf('--url');
  if (urlFlag >= 0 && argv[urlFlag + 1]) return [argv[urlFlag + 1]];

  const yearFlag = argv.indexOf('--year');
  const numFlag = argv.indexOf('--num');
  if (yearFlag >= 0 && numFlag >= 0) {
    const y = argv[yearFlag + 1];
    const n = argv[numFlag + 1];
    return [`https://www.austlii.edu.au/cgi-bin/viewdoc/au/cases/cth/HCA/${y}/${n}.html`];
  }
  return DEFAULT_URLS;
}

async function fetchHtml(url: string): Promise<string> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ userAgent: UA });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    return await page.content();
  } finally {
    await browser.close();
  }
}

function report(url: string, html: string): void {
  const p = parseHcaJudgment(html, url);
  console.log('\n============================================================');
  console.log(url);
  console.log('============================================================');
  console.log(`citation:        ${p.citation}`);
  console.log(`caseName:        ${p.caseName}`);
  console.log(`decisionDate:    ${p.decisionDate}   hearing: ${p.hearingDates}`);
  console.log(`judges:          ${JSON.stringify(p.judges)}`);
  console.log(`fileNumbers:     ${JSON.stringify(p.fileNumbers)}`);
  console.log(`parties:         ${p.parties ? p.parties.slice(0, 90) : '(none)'}`);
  console.log(`representation:  ${p.representation ? 'present' : '(NONE)'}`);
  console.log(`catchwords:      ${p.catchwords ? p.catchwords.slice(0, 90) : '(NONE)'}`);
  console.log(`orders:          ${p.decisionSummary ? p.decisionSummary.slice(0, 90) : '(none)'}`);
  console.log(`casesCited:      ${p.casesCited.length}   legislationCited: ${p.legislationCited.length}`);

  // Paragraph integrity — the critical check.
  const nums = p.paragraphs.map((x) => x.number);
  const gaps: string[] = [];
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] !== nums[i - 1] + 1) gaps.push(`${nums[i - 1]}->${nums[i]}`);
  }
  console.log(`paragraphCount:  ${p.paragraphCount}  (first=${nums[0]}, last=${nums[nums.length - 1]})`);
  console.log(`continuity:      ${gaps.length ? 'GAPS: ' + gaps.join(', ') : 'clean 1..N'}`);
  const stillHasRefs = p.paragraphs.some((x) => /\[\d+\]/.test(x.text));
  console.log(`footnote refs:   ${stillHasRefs ? 'STILL PRESENT (bug)' : 'stripped'}`);

  // Flags
  const flags: string[] = [];
  if (p.paragraphCount === 0) flags.push('ZERO PARAGRAPHS');
  if (p.judges.length === 0) flags.push('no judges');
  if (!p.catchwords) flags.push('no catchwords');
  if (!p.citation) flags.push('no citation');
  if (gaps.length) flags.push('paragraph gaps');
  console.log(`FLAGS:           ${flags.length ? '⚠ ' + flags.join(', ') : 'none — looks good'}`);
}

async function main(): Promise<void> {
  const urls = parseArgs();
  console.log(`Testing HCA parser against ${urls.length} case(s)...`);
  for (const url of urls) {
    try {
      const html = await fetchHtml(url);
      report(url, html);
    } catch (err) {
      console.log(`\n[FAILED] ${url}`);
      console.log(`  ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log('\nDone. Review FLAGS above — any ⚠ means the parser needs work on that case type.');
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});