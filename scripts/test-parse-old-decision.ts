// scripts/test-parse-old-decision.ts
import fs from 'node:fs/promises';
import { parseNswJudgment } from '../lib/parsers/nsw-caselaw';

async function main() {
  const midEra = parseNswJudgment(
    await fs.readFile('scripts/output/old-decision.html', 'utf8'),
    'https://www.caselaw.nsw.gov.au/decision/54a640003004de94513dca94',
  );
  console.log('=== NETCAT (Stankovic) ===');
  console.log('citation:       ', midEra.citation);
  console.log('paragraphCount: ', midEra.paragraphCount, '(expect 39)');

  const reid = parseNswJudgment(
    await fs.readFile('scripts/output/old-decision-2.html', 'utf8'),
    'https://www.caselaw.nsw.gov.au/decision/549f9b413004262463b16eb4',
  );
  console.log('\n=== LOTUS 1999 (Reid) ===');
  console.log('citation:       ', reid.citation);
  console.log('paragraphCount: ', reid.paragraphCount, '(expect 72)');

  const fang = parseNswJudgment(
    await fs.readFile('scripts/output/old-decision-3.html', 'utf8'),
    'https://www.caselaw.nsw.gov.au/decision/549fb2f53004262463b869bd',
  );
  console.log('\n=== LOTUS 2003 (Fangupo) ===');
  console.log('citation:       ', fang.citation);
  console.log('paragraphCount: ', fang.paragraphCount, '(expect 38)');
  console.log('first para:     ', fang.paragraphs[0]?.text.slice(0, 60));
  console.log('last para num:  ', fang.paragraphs[fang.paragraphs.length - 1]?.number);
}

main();