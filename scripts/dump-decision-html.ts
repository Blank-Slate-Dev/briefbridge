// scripts/dump-decision-html.ts
// Fetches one NSW Caselaw decision page and saves its raw HTML to disk.
//
// Currently pointed at a ~1990 NSWCA decision from the pre-2000 Court of
// Appeal window, where ~3,000 cases are failing wholesale — checking
// whether these are HTML at all or stubs pointing at scanned documents.

import fs from 'node:fs/promises';

const URL = 'https://www.caselaw.nsw.gov.au/decision/549f513630042624639fb1fa';
const OUT = 'scripts/output/old-decision-4.html';

async function main() {
  const res = await fetch(URL, {
    headers: { 'User-Agent': 'BriefBridge-Ingest/0.1 (oakley@briefbridge.ai)' },
  });
  console.log(`HTTP ${res.status}`);
  const html = await res.text();
  await fs.writeFile(OUT, html);
  console.log(`Saved ${html.length} chars to ${OUT}`);
}

main();