// scripts/probe-cth-acts.ts
//
// Probes every in-force Cth principal Act listed in
// scripts/output/cth-acts-in-force.csv. For each one:
//
//   1. Fetches the combined HTML via lib/legislation/fetch.ts
//      (walks all document_N.html files)
//   2. Runs lib/legislation/parser.ts on the combined HTML to extract
//      sections (the same parser used by the real ingest)
//   3. Records: section count, total body text characters, document
//      count, total source bytes, parser warnings count
//
// Writes per-Act results to scripts/output/cth-acts-probe.csv as it
// goes (so partial progress is preserved if the script is interrupted).
//
// Throttles 100ms between Acts (within an Act's docs there's no extra
// throttle — those are sequential anyway).
//
// On the first hard error (404, malformed HTML, parser exception),
// stops and reports — per user's instruction "Stop on any error and
// tell me".
//
// Run:
//   npx tsx scripts/probe-cth-acts.ts
//
// Resume after interruption:
//   npx tsx scripts/probe-cth-acts.ts --resume
//   (skips any registration_id already present in the output CSV)

import { mkdir, writeFile, appendFile, readFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fetchActHtml } from '@/lib/legislation/fetch';
import { parseLegislationHtml } from '@/lib/legislation/parser';
import { buildActCitation } from '@/lib/legislation/citations';

const INPUT_CSV = join(process.cwd(), 'scripts', 'output', 'cth-acts-in-force.csv');
const OUTPUT_CSV = join(process.cwd(), 'scripts', 'output', 'cth-acts-probe.csv');

// 100ms between Acts (as agreed).
const THROTTLE_MS = 100;

// Output columns
const OUTPUT_HEADERS = [
  'registration_id',
  'title',
  'portfolio',
  'compilation_date',
  'document_count',
  'total_source_bytes',
  'section_count',
  'body_text_chars',
  'parser_warnings',
  'elapsed_ms',
] as const;

// =============================================================================
// Args
// =============================================================================

interface Args {
  resume: boolean;
}

function parseArgs(): Args {
  return {
    resume: process.argv.includes('--resume'),
  };
}

// =============================================================================
// CSV utilities
// =============================================================================

function csvEscape(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Minimal CSV parser for our own well-formed CSV. Handles quoted fields
 * with embedded commas/quotes. Returns an array of objects keyed by
 * the header row.
 */
function parseCsv(text: string): Record<string, string>[] {
  // Normalize line endings.
  const normalized = text.replace(/\r\n/g, '\n');

  // Tokenize. RFC 4180-ish: quoted fields, doubled "" for literal quote.
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];

    if (inQuotes) {
      if (c === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
      } else {
        field += c;
      }
    }
  }
  // Trailing field/row if file doesn't end with newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (rows.length === 0) return [];

  const headers = rows[0];
  const out: Record<string, string>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    // Skip blank trailing rows.
    if (r.length === 1 && r[0] === '') continue;
    const obj: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      obj[headers[j]] = r[j] ?? '';
    }
    out.push(obj);
  }
  return out;
}

// =============================================================================
// Body text counting
// =============================================================================

/**
 * Extract body text characters from the parsed sections. This is the
 * "what would actually get embedded" measure — heading text + section
 * text, summed.
 *
 * Embedding text doesn't need the structural markup, just the prose.
 * This count maps directly to tokens via the empirical ratio from your
 * 5 ingested Acts.
 */
function countBodyTextChars(
  sections: Array<{ heading?: string | null; text: string }>,
): number {
  let total = 0;
  for (const s of sections) {
    if (s.heading) total += s.heading.length;
    total += s.text.length;
  }
  return total;
}

// =============================================================================
// Probe one Act
// =============================================================================

interface ProbeResult {
  registration_id: string;
  title: string;
  portfolio: string;
  compilation_date: string;
  document_count: number;
  total_source_bytes: number;
  section_count: number;
  body_text_chars: number;
  parser_warnings: number;
  elapsed_ms: number;
}

async function probeOneAct(
  registrationId: string,
  title: string,
  portfolio: string,
  compilationDate: string,
): Promise<ProbeResult> {
  const start = Date.now();

  // Step 1: fetch all documents for this Act.
  const fetchResult = await fetchActHtml(registrationId, compilationDate);

  // Step 2: parse.
  const actCitation = buildActCitation(title, 'commonwealth');
  const parseResult = parseLegislationHtml(fetchResult.html, {
    actCitation,
    jurisdiction: 'commonwealth',
  });

  // Step 3: compute body-text character count.
  const bodyTextChars = countBodyTextChars(parseResult.sections);

  const elapsed = Date.now() - start;

  return {
    registration_id: registrationId,
    title,
    portfolio,
    compilation_date: compilationDate,
    document_count: fetchResult.documents.length,
    total_source_bytes: fetchResult.totalSourceBytes,
    section_count: parseResult.sections.length,
    body_text_chars: bodyTextChars,
    parser_warnings: parseResult.warnings.length,
    elapsed_ms: elapsed,
  };
}

// =============================================================================
// Main
// =============================================================================

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const args = parseArgs();

  // Load the input CSV.
  console.error(`[probe] reading ${INPUT_CSV}`);
  const inputText = await readFile(INPUT_CSV, 'utf8');
  const inputRows = parseCsv(inputText);
  console.error(`[probe] ${inputRows.length} Acts to probe`);

  // Resume mode: read any existing output and skip those Acts.
  const already = new Set<string>();
  if (args.resume && (await fileExists(OUTPUT_CSV))) {
    const existingText = await readFile(OUTPUT_CSV, 'utf8');
    const existingRows = parseCsv(existingText);
    for (const r of existingRows) {
      if (r.registration_id) already.add(r.registration_id);
    }
    console.error(`[probe] resume mode: ${already.size} Acts already probed, will skip`);
  } else {
    // Fresh run: write header.
    await mkdir(dirname(OUTPUT_CSV), { recursive: true });
    await writeFile(OUTPUT_CSV, OUTPUT_HEADERS.join(',') + '\n', 'utf8');
  }

  // Filter to remaining work.
  const toProbe = inputRows.filter((r) => !already.has(r.registration_id));
  console.error(`[probe] ${toProbe.length} Acts remaining to probe`);
  console.error('');

  const overallStart = Date.now();
  let totalSections = 0;
  let totalBodyChars = 0;
  let totalSourceBytes = 0;

  for (let i = 0; i < toProbe.length; i++) {
    const row = toProbe[i];
    const registrationId = row.registration_id;
    const title = row.title;
    const portfolio = row.portfolio;
    const compilationDate = row.compilation_date;

    if (!registrationId || !title || !compilationDate) {
      throw new Error(
        `Row ${i} missing required fields: ${JSON.stringify(row)}`,
      );
    }

    const elapsed = ((Date.now() - overallStart) / 1000).toFixed(0);
    process.stderr.write(
      `[${(i + 1).toString().padStart(4)}/${toProbe.length}] ` +
        `${registrationId} — ${title.slice(0, 50).padEnd(50)} ... `,
    );

    let result: ProbeResult;
    try {
      result = await probeOneAct(registrationId, title, portfolio, compilationDate);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('');
      console.error(`[ERROR] Probe failed for ${registrationId} (${title}):`);
      console.error(`        ${msg}`);
      if (err instanceof Error && err.stack) {
        console.error(err.stack);
      }
      console.error('');
      console.error(`[probe] Stopping per user instruction. ${i} Acts probed before error.`);
      console.error(`[probe] Run with --resume to continue after diagnosing.`);
      process.exit(1);
    }

    // Append the result to the output CSV.
    const line = OUTPUT_HEADERS.map((h) => csvEscape(result[h])).join(',');
    await appendFile(OUTPUT_CSV, line + '\n', 'utf8');

    totalSections += result.section_count;
    totalBodyChars += result.body_text_chars;
    totalSourceBytes += result.total_source_bytes;

    process.stderr.write(
      `${result.section_count.toString().padStart(5)} sections, ` +
        `${(result.body_text_chars / 1000).toFixed(0).padStart(5)}k chars, ` +
        `${result.document_count} doc(s), ` +
        `${(result.elapsed_ms / 1000).toFixed(1)}s\n`,
    );

    // Throttle between Acts (not within an Act's documents).
    if (i < toProbe.length - 1) {
      await new Promise((r) => setTimeout(r, THROTTLE_MS));
    }

    // Every 50 Acts, print a running total.
    if ((i + 1) % 50 === 0) {
      const seconds = (Date.now() - overallStart) / 1000;
      const minutes = (seconds / 60).toFixed(1);
      const remaining = toProbe.length - (i + 1);
      const projectedRemainingMin =
        (remaining * seconds) / (i + 1) / 60;
      console.error('');
      console.error(
        `  --- running totals: ${totalSections.toLocaleString()} sections, ` +
          `${(totalBodyChars / 1_000_000).toFixed(1)}M body chars, ` +
          `${(totalSourceBytes / 1_000_000).toFixed(0)}MB source ` +
          `| ${minutes} min elapsed, ~${projectedRemainingMin.toFixed(0)} min remaining ---`,
      );
      console.error('');
    }
  }

  const totalSeconds = (Date.now() - overallStart) / 1000;
  const totalMinutes = (totalSeconds / 60).toFixed(1);

  console.error('');
  console.error('========================================');
  console.error('Probe complete.');
  console.error('========================================');
  console.error(`Acts probed:        ${toProbe.length.toLocaleString()}`);
  console.error(`Total sections:     ${totalSections.toLocaleString()}`);
  console.error(`Total body chars:   ${totalBodyChars.toLocaleString()}`);
  console.error(`Total source bytes: ${totalSourceBytes.toLocaleString()}`);
  console.error(`Elapsed:            ${totalMinutes} min`);
  console.error('========================================');
  console.error('');
  console.error(`Output written to: ${OUTPUT_CSV}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});