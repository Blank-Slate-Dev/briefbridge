// scripts/verify-recall-fix.ts
//
// Verifies the ef_search recall fix by calling the ACTUAL patched search
// functions (lib/search/semantic-legislation.ts + semantic.ts) — the same
// code path the chat route uses.
//
// PASS = 'Civil Liability Act 2002 (NSW) s 5O' appears in legislation hits.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/verify-recall-fix.ts

import { semanticSearchLegislation } from '../lib/search/semantic-legislation';
import { semanticSearch } from '../lib/search/semantic';

const QUERY =
  'What is the standard of care for medical professionals in NSW, and how does the peer professional opinion defence operate?';

async function main() {
  console.log('Testing patched search functions...\n');

  const leg = await semanticSearchLegislation(QUERY, { limit: 7 });
  console.log('--- LEGISLATION HITS (via patched semanticSearchLegislation) ---');
  leg.forEach((h, i) =>
    console.log(`  ${i + 1}. ${(h.similarity * 100).toFixed(1)}%  ${h.citation}`),
  );

  const s5o = leg.find((h) => h.citation.includes('s 5O'));
  console.log(
    s5o
      ? `\nPASS — s 5O retrieved at ${(s5o.similarity * 100).toFixed(1)}%. Recall fix is working.`
      : `\nFAIL — s 5O not in legislation hits. Fix not effective; check the transaction/SET LOCAL path.`,
  );

  const cases = await semanticSearch(QUERY, { limit: 5 });
  console.log('\n--- TOP 5 CASELAW HITS (via patched semanticSearch) ---');
  cases.forEach((h, i) =>
    console.log(
      `  ${i + 1}. raw ${(h.similarity * 100).toFixed(1)}% | rank ${(h.rankScore * 100).toFixed(1)}% | ${h.judgment.citation} (${h.judgment.court})`,
    ),
  );

  process.exit(0);
}

main().catch((e) => { console.error('ERROR:', e instanceof Error ? e.message : e); process.exit(1); });