// scripts/test-gsc.ts
//
// Verifies the Search Console API connection end to end.
//   npx tsx --env-file=.env.local scripts/test-gsc.ts

import { gscQuery, gscTotals, isGscConfigured } from '../lib/gsc';

async function main() {
  if (!isGscConfigured()) {
    console.error('FAIL — GSC_CLIENT_EMAIL / GSC_PRIVATE_KEY missing from .env.local');
    process.exit(1);
  }

  const totals = await gscTotals(28);
  console.log('\n--- TOTALS (last 28 days) ---');
  console.log(`  clicks:      ${totals.clicks}`);
  console.log(`  impressions: ${totals.impressions}`);
  console.log(`  ctr:         ${(totals.ctr * 100).toFixed(2)}%`);
  console.log(`  avg position: ${totals.position.toFixed(1)}`);

  const pages = await gscQuery({ dimensions: ['page'], rowLimit: 5 });
  console.log('\n--- TOP 5 PAGES ---');
  pages.forEach((r) =>
    console.log(`  ${r.clicks} clicks | ${r.impressions} impr | pos ${r.position.toFixed(1)} | ${r.keys[0]}`),
  );

  const queries = await gscQuery({ dimensions: ['query'], rowLimit: 5 });
  console.log('\n--- TOP 5 QUERIES ---');
  queries.forEach((r) =>
    console.log(`  ${r.clicks} clicks | ${r.impressions} impr | ${r.keys[0]}`),
  );

  console.log(
    totals.impressions > 0
      ? '\nPASS — API connected and returning data.\n'
      : '\nConnected, but zero impressions in the window (check the date range / property).\n',
  );
  process.exit(0);
}

main().catch((e) => {
  console.error('ERROR:', e instanceof Error ? e.message : e);
  process.exit(1);
});