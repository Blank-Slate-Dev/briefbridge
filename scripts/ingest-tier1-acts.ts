// scripts/ingest-tier1-acts.ts
//
// Batch ingester for tier-1 Commonwealth Acts.
//
// Reads scripts/output/tier-1-acts.csv, skips Acts already in DB, and
// spawns `tsx scripts/ingest-legislation.ts` as a subprocess for each
// remaining Act (concurrency = 2). Per-Act logs go to
// scripts/output/ingest-logs/<registration_id>.log. After each Act
// finishes, queries DB for section count and updates parse_status:
//   - 'ok'             section count > 0
//   - 'partial'        subprocess failed, timed out, or 0 sections inserted
//
// Usage:
//   npx tsx scripts/ingest-tier1-acts.ts             # dry run by default
//   npx tsx scripts/ingest-tier1-acts.ts --go        # actually run
//   npx tsx scripts/ingest-tier1-acts.ts --go --only=C2004A04858  # single Act
//
// Resume semantics: re-running the script skips Acts that already exist
// in the legislation table. Safe to interrupt and re-run.

import 'dotenv/config';
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, existsSync, createWriteStream } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

// ===========================================================================
// Configuration
// ===========================================================================

const CSV_PATH = path.join(process.cwd(), 'scripts', 'output', 'tier-1-acts.csv');
const LOG_DIR = path.join(process.cwd(), 'scripts', 'output', 'ingest-logs');
const BATCH_LOG_PATH = path.join(LOG_DIR, '_batch.log');

const CONCURRENCY = 2;
const PER_ACT_TIMEOUT_MS = 30 * 60 * 1000; // 30 min

// ===========================================================================
// CLI parsing
// ===========================================================================

const argv = process.argv.slice(2);
const GO = argv.includes('--go');
const ONLY = (() => {
  const flag = argv.find((a) => a.startsWith('--only='));
  return flag ? flag.slice('--only='.length) : null;
})();

// ===========================================================================
// CSV parsing (minimal, no external lib)
// ===========================================================================

interface TierActRow {
  registration_id: string;
  title: string;
  compilation_date: string;
}

function parseCsv(): TierActRow[] {
  const raw = readFileSync(CSV_PATH, 'utf-8');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    throw new Error(`CSV is empty: ${CSV_PATH}`);
  }

  const header = lines[0].split(',').map((h) => h.trim());
  const regIdIdx = header.indexOf('registration_id');
  const titleIdx = header.indexOf('title');
  const compDateIdx = header.indexOf('compilation_date');
  if (regIdIdx < 0 || titleIdx < 0 || compDateIdx < 0) {
    throw new Error(
      `CSV missing required columns. Header: ${header.join(', ')}`,
    );
  }

  const rows: TierActRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    rows.push({
      registration_id: cells[regIdIdx] || '',
      title: cells[titleIdx] || '',
      compilation_date: cells[compDateIdx] || '',
    });
  }
  return rows;
}

/**
 * Minimal RFC 4180-ish CSV line parser — handles quoted fields with commas.
 * The tier-1 CSV doesn't have embedded commas in titles but defensive.
 */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === ',') {
        cells.push(cur);
        cur = '';
      } else if (ch === '"') {
        inQuotes = true;
      } else {
        cur += ch;
      }
    }
  }
  cells.push(cur);
  return cells;
}

// ===========================================================================
// DB helpers
// ===========================================================================

async function getAlreadyIngestedRegistrationIds(
  sql: ReturnType<typeof postgres>,
): Promise<Set<string>> {
  const rows = await sql`
    SELECT registration_id FROM legislation
    WHERE jurisdiction = 'commonwealth'
  `;
  return new Set(rows.map((r) => String(r.registration_id)));
}

async function getSectionCountForRegId(
  sql: ReturnType<typeof postgres>,
  registrationId: string,
): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*)::int AS count
    FROM legislation_sections
    WHERE legislation_id = (
      SELECT id FROM legislation
      WHERE registration_id = ${registrationId}
        AND jurisdiction = 'commonwealth'
    )
  `;
  if (rows.length === 0) return 0;
  return Number(rows[0].count);
}

async function updateParseStatus(
  sql: ReturnType<typeof postgres>,
  registrationId: string,
  status: 'ok' | 'partial',
): Promise<void> {
  await sql`
    UPDATE legislation
    SET parse_status = ${status}, updated_at = NOW()
    WHERE registration_id = ${registrationId}
      AND jurisdiction = 'commonwealth'
  `;
}

// ===========================================================================
// Subprocess runner
// ===========================================================================

interface IngestOutcome {
  registrationId: string;
  title: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
}

function runOneIngest(row: TierActRow): Promise<IngestOutcome> {
  return new Promise((resolve) => {
    const start = Date.now();
    const logPath = path.join(LOG_DIR, `${row.registration_id}.log`);
    const logStream = createWriteStream(logPath, { flags: 'w' });

    // Spawn `node` directly with tsx's CLI script. This is the only
    // reliable cross-platform approach:
    //   - npx + shell: true → Windows cmd.exe strips quotes around
    //     multi-word args, truncating "Crimes Act 1914" → "Crimes"
    //   - .cmd binary + shell: false → Node throws EINVAL since v18
    //   - node + tsx CLI .mjs + shell: false → works
    // With shell: false, Node passes args as discrete argv entries.
    // Spaces inside individual args (like the title) are preserved.
    const tsxCli = path.join(
      process.cwd(),
      'node_modules',
      'tsx',
      'dist',
      'cli.mjs',
    );

    const args = [
      tsxCli,
      '--env-file=.env.local',
      'scripts/ingest-legislation.ts',
      `--registration-id=${row.registration_id}`,
      `--short-title=${row.title}`,
      `--compilation-date=${row.compilation_date}`,
    ];

    const proc = spawn(process.execPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      env: process.env,
    });

    proc.stdout.pipe(logStream, { end: false });
    proc.stderr.pipe(logStream, { end: false });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, PER_ACT_TIMEOUT_MS);

    proc.on('close', (code) => {
      clearTimeout(timer);
      logStream.end();
      resolve({
        registrationId: row.registration_id,
        title: row.title,
        exitCode: code,
        timedOut,
        durationMs: Date.now() - start,
      });
    });
  });
}

// ===========================================================================
// Concurrency runner
// ===========================================================================

async function runWithConcurrency(
  rows: TierActRow[],
  sql: ReturnType<typeof postgres>,
  batchLog: ReturnType<typeof createWriteStream>,
): Promise<void> {
  let nextIdx = 0;
  let inFlight = 0;
  let completed = 0;
  const total = rows.length;
  const failures: IngestOutcome[] = [];

  return new Promise<void>((resolve) => {
    const tryStartMore = () => {
      while (inFlight < CONCURRENCY && nextIdx < rows.length) {
        const row = rows[nextIdx++];
        inFlight++;
        const startedAt = new Date().toISOString();
        const msg = `[${startedAt}] START ${row.registration_id} ${row.title}`;
        console.log(msg);
        batchLog.write(msg + '\n');

        runOneIngest(row).then(async (outcome) => {
          inFlight--;
          completed++;

          // Decide parse_status based on outcome + DB section count.
          let status: 'ok' | 'partial' = 'partial';
          let sectionCount = 0;
          if (outcome.exitCode === 0 && !outcome.timedOut) {
            try {
              sectionCount = await getSectionCountForRegId(
                sql,
                row.registration_id,
              );
              status = sectionCount > 0 ? 'ok' : 'partial';
            } catch {
              status = 'partial';
            }
          }

          // Update DB if the legislation row exists. updateParseStatus is
          // a no-op if no row (which is fine — failed ingest).
          try {
            await updateParseStatus(sql, row.registration_id, status);
          } catch {
            /* swallow — best-effort */
          }

          const finishedAt = new Date().toISOString();
          const durationMin = (outcome.durationMs / 60_000).toFixed(1);
          const summary =
            `[${finishedAt}] ${status === 'ok' ? 'OK     ' : 'FAILED '}` +
            `${row.registration_id} ` +
            `(${sectionCount} sections, ${durationMin}min, ` +
            `exit=${outcome.exitCode}${outcome.timedOut ? ' TIMEOUT' : ''}) ` +
            `[${completed}/${total}]`;
          console.log(summary);
          batchLog.write(summary + '\n');

          if (status !== 'ok') failures.push(outcome);

          if (completed === total) {
            resolve();
          } else {
            tryStartMore();
          }
        });
      }
    };

    tryStartMore();
  }).then(() => {
    if (failures.length > 0) {
      const msg = `\nFAILURES (${failures.length}):`;
      console.log(msg);
      batchLog.write(msg + '\n');
      for (const f of failures) {
        const line = `  ${f.registrationId} ${f.title} (exit=${f.exitCode}${f.timedOut ? ' TIMEOUT' : ''})`;
        console.log(line);
        batchLog.write(line + '\n');
      }
    }
  });
}

// ===========================================================================
// Main
// ===========================================================================

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL env var must be set');
  }

  // Ensure log dir exists.
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }

  // Load CSV.
  let allRows = parseCsv();
  console.log(`[batch] read ${allRows.length} Acts from ${CSV_PATH}`);

  // Filter to --only if provided.
  if (ONLY) {
    allRows = allRows.filter((r) => r.registration_id === ONLY);
    if (allRows.length === 0) {
      throw new Error(`--only=${ONLY} matched no rows in CSV`);
    }
    console.log(`[batch] filtered to --only=${ONLY}: ${allRows.length} Acts`);
  }

  // Connect DB and find already-ingested.
  const sql = postgres(process.env.DATABASE_URL, { max: 3, prepare: false });
  const ingested = await getAlreadyIngestedRegistrationIds(sql);
  const todo = allRows.filter((r) => !ingested.has(r.registration_id));
  const skipping = allRows.filter((r) => ingested.has(r.registration_id));

  console.log(`\n[batch] already ingested (will skip): ${skipping.length}`);
  for (const r of skipping) {
    console.log(`  SKIP  ${r.registration_id} ${r.title}`);
  }
  console.log(`\n[batch] will ingest: ${todo.length}`);
  for (const r of todo) {
    console.log(`  TODO  ${r.registration_id} ${r.title} @ ${r.compilation_date}`);
  }

  if (todo.length === 0) {
    console.log('\n[batch] nothing to do — exiting');
    await sql.end();
    return;
  }

  if (!GO) {
    console.log(
      '\n[batch] DRY RUN. Re-run with --go to actually ingest. ' +
        `Concurrency=${CONCURRENCY}, per-Act timeout=${PER_ACT_TIMEOUT_MS / 60_000}min.`,
    );
    await sql.end();
    return;
  }

  // Real run.
  const batchLog = createWriteStream(BATCH_LOG_PATH, { flags: 'a' });
  const startedAt = new Date().toISOString();
  const header = `\n=== BATCH START ${startedAt} — ${todo.length} Acts, concurrency=${CONCURRENCY} ===`;
  console.log(header);
  batchLog.write(header + '\n');

  await runWithConcurrency(todo, sql, batchLog);

  const finishedAt = new Date().toISOString();
  const footer = `\n=== BATCH END ${finishedAt} ===`;
  console.log(footer);
  batchLog.write(footer + '\n');
  batchLog.end();
  await sql.end();
}

main().catch((err) => {
  console.error('[batch] fatal error:', err);
  process.exit(1);
});