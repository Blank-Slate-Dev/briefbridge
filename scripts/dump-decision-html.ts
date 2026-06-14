// scripts/dump-decision-html.ts
// Fetches one NSW Caselaw decision page and saves its raw HTML to disk.
//
// Pointed at a 2009-2013 NSWCA case that is failing 100% during retry —
// a range where the parser is known to work, so checking whether the
// server is returning a real judgment or a block/challenge page.

import fs from 'node:fs/promises';

const URL = 'https://www.caselaw.nsw.gov.au/decision/549ff6fc3004262463c67e04';
const OUT = 'scripts/output/check-block.html';

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