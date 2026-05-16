const acts = [
  { regId: 'C1901A00002', date: '2024-12-11', label: 'Acts Interpretation Act 1901' },
  { regId: 'C2010A00052', date: '2024-12-11', label: 'Australian Information Commissioner Act 2010' },
  { regId: 'C2004A03712', date: '2025-02-01', label: 'Privacy Act 1988' },
  { regId: 'C2009A00028', date: '2026-04-02', label: 'Fair Work Act 2009 (expected FAIL until re-ingest)' },
];

import { spawnSync } from 'node:child_process';

const results: Array<{ label: string; status: number }> = [];

for (const a of acts) {
  console.log('\n' + '#'.repeat(70));
  console.log(`# ${a.label}`);
  console.log(`# ${a.regId} @ ${a.date}`);
  console.log('#'.repeat(70));
  const r = spawnSync(
    'npx',
    [
      'tsx',
      'scripts/verify-legislation.ts',
      `--registration-id=${a.regId}`,
      `--compilation-date=${a.date}`,
    ],
    { stdio: 'inherit', shell: true },
  );
  results.push({ label: a.label, status: r.status ?? -1 });
}

console.log('\n' + '='.repeat(70));
console.log('SUMMARY');
console.log('='.repeat(70));
for (const r of results) {
  const tag = r.status === 0 ? 'PASS' : `FAIL (exit ${r.status})`;
  console.log(`  ${tag.padEnd(15)} ${r.label}`);
}
const failed = results.filter((r) => r.status !== 0).length;
process.exit(failed > 0 ? 1 : 0);
