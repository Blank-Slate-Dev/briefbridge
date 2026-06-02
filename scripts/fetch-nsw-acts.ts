// scripts/fetch-nsw-acts.ts
//
// Batch-download NSW Act XML files from legislation.nsw.gov.au, bypassing
// Cloudflare's JavaScript challenge via a real Chromium browser.
//
// Files are saved using the same name the browser produces
// (<registration-id>_<compilation-date>.xml), so the existing batch ingest
// loop picks them up without any change to scripts/ingest-nsw-legislation.ts.
//
// Usage:
//   # Fetch a list of Acts (comma-separated, no spaces)
//   npx tsx scripts/fetch-nsw-acts.ts \
//     --ids=act-2005-028,act-1995-025,act-1999-092,act-1919-006,act-1900-025,act-2006-080,act-2005-077
//
//   # One Act
//   npx tsx scripts/fetch-nsw-acts.ts --ids=act-2002-022
//
//   # Save somewhere other than ~/Downloads
//   npx tsx scripts/fetch-nsw-acts.ts --ids=act-2002-022 --output-dir="C:\briefbridge-xml"
//
//   # Show the browser window — useful if headless Chromium gets challenged
//   # and you need to pass a captcha manually once. Cookies then persist for
//   # the rest of the batch.
//   npx tsx scripts/fetch-nsw-acts.ts --ids=act-2002-022 --headed
//
// First-time setup (after `npm install -D playwright`):
//   npx playwright install chromium
//
// Counterpart to scripts/ingest-tier1-acts.ts (Cth bulk ingester). Sister
// script to scripts/ingest-nsw-legislation.ts — fetch first with this,
// then ingest with the existing loop.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  launchNswBrowser,
  fetchNswActXml,
  batchDelay,
} from '@/lib/legislation/fetch-nsw';

// =============================================================================
// Argument parsing
// =============================================================================

interface Args {
  ids: string[];
  outputDir: string;
  headed: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const flag = argv.find((a) => a.startsWith(`--${name}=`));
    return flag ? flag.slice(`--${name}=`.length) : undefined;
  };
  const has = (name: string): boolean => argv.includes(`--${name}`);

  const idsArg = get('ids');
  if (!idsArg) {
    console.error(`
Usage: npx tsx scripts/fetch-nsw-acts.ts --ids=<id1>,<id2>,...

Examples:
  --ids=act-2002-022
  --ids=act-2005-028,act-1995-025,act-1999-092

Optional:
  --output-dir=<path>   (default: ~/Downloads)
  --headed              (show browser window; pass once if challenged)

First-time only: npx playwright install chromium
`);
    process.exit(1);
  }

  const ids = idsArg
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    console.error('No registration IDs provided.');
    process.exit(1);
  }

  return {
    ids,
    outputDir: get('output-dir') ?? path.join(os.homedir(), 'Downloads'),
    headed: has('headed'),
  };
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const args = parseArgs();

  if (!fs.existsSync(args.outputDir)) {
    fs.mkdirSync(args.outputDir, { recursive: true });
  }
  console.error(`[fetch-nsw-acts] output dir: ${args.outputDir}`);
  console.error(`[fetch-nsw-acts] ${args.ids.length} Act(s) to fetch\n`);

  const { browser, context } = await launchNswBrowser({ headless: !args.headed });
  let ok = 0;
  let failed = 0;
  const failures: { id: string; reason: string }[] = [];

  try {
    for (let i = 0; i < args.ids.length; i++) {
      const id = args.ids[i];
      const prefix = `[${i + 1}/${args.ids.length}]`;
      try {
        const result = await fetchNswActXml(id, { context });
        const filename = `${id}_${result.compilationDate}.xml`;
        const filepath = path.join(args.outputDir, filename);
        fs.writeFileSync(filepath, result.xml);
        console.error(`${prefix} ${id}: saved ${filename} (${result.bytes.toLocaleString()} bytes)\n`);
        ok++;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`${prefix} ${id}: FAILED — ${reason}\n`);
        failed++;
        failures.push({ id, reason });
      }

      if (i < args.ids.length - 1) {
        await batchDelay();
      }
    }
  } finally {
    await browser.close();
  }

  console.error(`========================================`);
  console.error(`Fetch complete.`);
  console.error(`  Ok:     ${ok}`);
  console.error(`  Failed: ${failed}`);
  console.error(`  Output: ${args.outputDir}`);
  console.error(`========================================`);
  if (failures.length > 0) {
    console.error(`\nFailures:`);
    for (const f of failures) console.error(`  ${f.id}: ${f.reason}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[fatal] ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});