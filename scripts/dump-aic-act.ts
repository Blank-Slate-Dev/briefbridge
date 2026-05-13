// scripts/dump-aic-act.ts
//
// Reconstructs the Australian Information Commissioner Act 2010 from the DB
// as a plain-text file for word-for-word comparison against source HTML.
//
// Usage: npx tsx scripts/dump-aic-act.ts
// Output: aic-act-from-db.txt in the project root.

import { config } from 'dotenv';
config({ path: '.env.local' });
import { writeFileSync } from 'fs';
import postgres from 'postgres';

const AIC_ACT_ID = '937408c3-11b7-42e1-8bb2-f6ef72c6e108';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Check .env.local');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false });

async function main() {
  const [act] = await sql`
    SELECT * FROM legislation WHERE id = ${AIC_ACT_ID}
  `;

  if (!act) {
    console.error(`Act ${AIC_ACT_ID} not found in legislation table`);
    process.exit(1);
  }

  const sections = await sql`
    SELECT *
    FROM legislation_sections
    WHERE legislation_id = ${AIC_ACT_ID}
    ORDER BY sort_order
  `;

  const lines: string[] = [];
  const title = act.short_title ?? 'Unknown Act';
  const cite = `${title} (${act.jurisdiction === 'commonwealth' ? 'Cth' : act.jurisdiction})`;

  lines.push(title);
  if (act.long_title) lines.push(act.long_title);
  lines.push(`Citation: ${cite}`);
  if (act.compilation_date) lines.push(`Compilation: ${act.compilation_date}`);
  lines.push(`Sections in DB: ${sections.length}`);
  lines.push(`Reconstructed: ${new Date().toISOString()}`);
  lines.push('='.repeat(80));
  lines.push('');

  for (const s of sections) {
    const level = s.level ?? '';
    const number = s.number ?? '';
    const heading = s.heading ?? '';
    const body = s.text ?? '';
    const citation = s.citation ?? '';
    const breadcrumb = s.breadcrumb ?? '';
    const path = s.path ?? '';

    if (level === 'chapter' || level === 'part' || level === 'division' || level === 'subdivision') {
      lines.push('');
      const label = `${level[0].toUpperCase() + level.slice(1)} ${number}`.trim();
      lines.push(`━━━ ${label}${heading ? ` — ${heading}` : ''}`);
      lines.push(`    [${citation}]   breadcrumb=${breadcrumb}   path=${path}`);
      if (body) {
        lines.push('');
        lines.push(body);
      }
      lines.push('');
    } else if (level === 'schedule') {
      lines.push('');
      lines.push('='.repeat(80));
      lines.push(`Schedule ${number}${heading ? ` — ${heading}` : ''}`);
      lines.push('='.repeat(80));
      lines.push(`    [${citation}]   breadcrumb=${breadcrumb}   path=${path}`);
      if (body) {
        lines.push('');
        lines.push(body);
      }
      lines.push('');
    } else if (level === 'schedule_part') {
      lines.push('');
      lines.push(`--- Schedule Part ${number}${heading ? ` — ${heading}` : ''}`);
      lines.push(`    [${citation}]   breadcrumb=${breadcrumb}   path=${path}`);
      if (body) {
        lines.push('');
        lines.push(body);
      }
      lines.push('');
    } else if (level === 'schedule_clause') {
      lines.push('');
      lines.push(`Clause ${number}${heading ? ` — ${heading}` : ''}`);
      lines.push(`    [${citation}]   breadcrumb=${breadcrumb}   path=${path}`);
      if (body) {
        lines.push('');
        lines.push(body);
      }
      lines.push('');
    } else {
      // section, subsection, or anything else
      lines.push('');
      lines.push(`${number ? number + '  ' : ''}${heading}`);
      lines.push(`    [${citation}]   level=${level}   breadcrumb=${breadcrumb}   path=${path}`);
      if (body) {
        lines.push('');
        lines.push(body);
      }
      lines.push('');
    }
  }

  lines.push('');
  lines.push('='.repeat(80));
  lines.push('End of dump.');

  writeFileSync('aic-act-from-db.txt', lines.join('\n'), 'utf8');
  console.log(`Wrote aic-act-from-db.txt — ${sections.length} sections, ${lines.length} lines`);
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
