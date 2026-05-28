// scripts/test-nsw-parser.ts
//
// Read-only smoke test for lib/legislation/parser-nsw.ts.
//
// Parses a local NSW Act XML file and prints the parsed tree + integrity
// checks. Writes NOTHING to the database. No attribution / ingester needed.
//
// Usage:
//   npx tsx scripts/test-nsw-parser.ts
//   npx tsx scripts/test-nsw-parser.ts --file="C:\path\to\act-2002-022_2022-06-16.xml"
//
// If --file is omitted, it searches your Downloads / OneDrive\Downloads /
// OneDrive\Documents / the repo root for the most recent  act-*.xml  file.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseNswLegislationXml } from '@/lib/legislation/parser-nsw';

function getArg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const flag = argv.find((a) => a.startsWith(`--${name}=`));
  if (flag) return flag.slice(`--${name}=`.length);
  const idx = argv.indexOf(`--${name}`);
  if (idx >= 0 && argv[idx + 1] && !argv[idx + 1].startsWith('--')) {
    return argv[idx + 1];
  }
  return undefined;
}

function locateXml(explicit?: string): string {
  if (explicit) {
    if (!fs.existsSync(explicit)) {
      throw new Error(`File not found: ${explicit}`);
    }
    return explicit;
  }
  const home = os.homedir();
  const dirs = [
    path.join(home, 'Downloads'),
    path.join(home, 'OneDrive', 'Downloads'),
    path.join(home, 'OneDrive', 'Documents'),
    process.cwd(),
  ];
  let best: { p: string; m: number } | null = null;
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(d);
    } catch {
      continue;
    }
    for (const f of entries) {
      if (/^act-.*\.xml$/i.test(f)) {
        const full = path.join(d, f);
        try {
          const m = fs.statSync(full).mtimeMs;
          if (!best || m > best.m) best = { p: full, m };
        } catch {
          /* ignore */
        }
      }
    }
  }
  if (!best) {
    throw new Error(
      'No act-*.xml found in Downloads / OneDrive. Pass --file="C:\\full\\path\\to\\act-XXXX-XXX.xml".',
    );
  }
  return best.p;
}

function main(): void {
  const file = locateXml(getArg('file'));
  console.log(`[test] parsing: ${file}\n`);

  const xml = fs.readFileSync(file, 'utf8');
  const r = parseNswLegislationXml(xml);

  // --- Act metadata ---
  console.log('=== ACT METADATA (from <exdoc> attributes) ===');
  console.log(`  registrationId: ${r.meta.registrationId}`);
  console.log(`  shortTitle:     ${r.meta.shortTitle}`);
  console.log(`  citation:       ${r.meta.shortTitle} (NSW)`);
  console.log(`  year / number:  ${r.meta.year} / ${r.meta.number}`);
  console.log(`  compilationDate:${r.compilationDate}`);
  console.log(
    `  longTitle:      ${r.meta.longTitle ? r.meta.longTitle.slice(0, 90) + '…' : '(none)'}`,
  );

  // --- Counts ---
  const byLevel: Record<string, number> = {};
  for (const s of r.sections) byLevel[s.level] = (byLevel[s.level] || 0) + 1;
  console.log(`\n=== ROW COUNTS ===`);
  console.log(`  total rows: ${r.sections.length}`);
  for (const [lvl, n] of Object.entries(byLevel)) {
    console.log(`    ${lvl.padEnd(16)} ${n}`);
  }
  console.log(`  warnings:   ${r.warnings.length}`);
  for (const w of r.warnings.slice(0, 10)) console.log(`    - ${w}`);

  // --- Integrity checks ---
  const badParent = r.sections.filter(
    (s, i) => s.parentIndex !== -1 && !(s.parentIndex >= 0 && s.parentIndex < i),
  );
  const contentRows = r.sections.filter(
    (s) => s.level === 'section' || s.level === 'schedule_clause',
  );
  const emptyContent = contentRows.filter((s) => !s.text.trim());
  console.log(`\n=== INTEGRITY ===`);
  console.log(`  invalid parent refs:               ${badParent.length}`);
  console.log(
    `  section/schedule_clause rows:      ${contentRows.length}`,
  );
  console.log(
    `  …with EMPTY text (repealed/header): ${emptyContent.length}`,
  );
  for (const s of emptyContent.slice(0, 10)) {
    console.log(`      ${s.citation}  heading=${s.heading ?? 'null'}`);
  }

  // --- Sample sections ---
  const samples = [
    r.sections.find((s) => s.level === 'section'),
    r.sections.find((s) => s.text.includes('\n(2)')), // a multi-subsection section
    r.sections.find((s) => s.text.includes(' | ')), // a section with a table
    r.sections.find((s) => s.level === 'schedule_clause'),
  ].filter(Boolean) as typeof r.sections;

  console.log(`\n=== SAMPLE SECTIONS ===`);
  for (const s of samples) {
    console.log('\n' + '-'.repeat(66));
    console.log(`  citation:   ${s.citation}`);
    console.log(`  breadcrumb: ${s.breadcrumb}`);
    console.log(`  heading:    ${s.heading ?? '(none)'}`);
    console.log(`  path:       ${s.path}`);
    const preview = s.text.length > 600 ? s.text.slice(0, 600) + '\n  …[truncated]' : s.text;
    console.log(`  text:\n${preview.split('\n').map((l) => '    ' + l).join('\n')}`);
  }

  console.log(`\n[test] done — nothing was written to the database.`);
}

main();