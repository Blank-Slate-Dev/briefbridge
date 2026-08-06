// scripts/outreach/verify-list.ts
//
//   npx tsx scripts/outreach/verify-list.ts
//
// Takes out/contacts.csv and produces out/send-queue.csv — the list actually
// worth emailing, ordered.
//
// Three things happen here, in order of how much they matter:
//
// 1. CORPUS FIT. This is the one that saves you from burning the market.
//    BriefBridge's corpus is NSWSC / NSWCA / NSWCCA / HCA / Cth Acts /
//    NSW Acts. A family law barrister practises in the Federal Circuit and
//    Family Court — none of which is in the corpus. Emailing them a demo they
//    will find empty is worse than not emailing them: it spends a contact AND
//    produces a bad first impression in a profession of ~6,000 people who all
//    know each other. Same for migration (Federal Court/AAT), workers comp
//    (Personal Injury Commission) and planning (NSWLEC).
//
// 2. DELIVERABILITY. MX-verify every domain. A bounce on a cold send is a
//    direct hit to sending reputation, and at 30-50/day you cannot absorb many.
//
// 3. SUPPRESSION. Anyone previously emailed, anyone who unsubscribed, anyone
//    on the manual do-not-contact list, is removed. Unsubscribes are honoured
//    permanently — the Spam Act requires 5 business days; permanent is easier
//    to implement and impossible to get wrong.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveMx } from 'node:dns/promises';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'out');
const SUPPRESSION_PATH = join(OUT_DIR, 'suppression.csv');
const SENT_LOG_PATH = join(OUT_DIR, 'sent-log.csv');

/* --------------------------- corpus fit ------------------------------ */

/** Practice areas the current corpus genuinely serves. */
const STRONG_FIT = [
  'commercial', 'equity', 'contract', 'corporations', 'insolvency', 'restructuring',
  'common law', 'personal injury', 'negligence', 'professional negligence',
  'medical negligence', 'insurance', 'succession', 'wills', 'estates',
  'probate', 'family provision', 'trusts', 'property', 'real property',
  'building', 'construction', 'defamation', 'administrative', 'public law',
  'appellate', 'criminal', 'crime', 'coronial', 'inquest', 'proceeds of crime',
  'banking', 'finance', 'competition', 'consumer', 'partnership',
  'professional discipline', 'costs', 'arbitration', 'commercial litigation',
];

/** Areas where the corpus has statutes but not the relevant case law. */
const PARTIAL_FIT = [
  'employment', 'industrial', 'work health', 'whs', 'discrimination',
  'tax', 'revenue', 'intellectual property', 'media', 'communications',
  'environment', 'planning', 'land and environment', 'local government',
  'native title', 'human rights', 'international',
];

/**
 * Areas the corpus does NOT serve. These are not bad barristers — they are
 * the wrong first audience for THIS corpus, today.
 */
const POOR_FIT = [
  'family law', 'family', 'parenting', 'child welfare', 'care and protection',
  'de facto', 'divorce', 'migration', 'immigration', 'refugee',
  'workers compensation', 'workers comp', 'motor accident', 'ctp',
  'social security', 'ndis', 'mental health', 'guardianship',
];

function scoreFit(practiceAreas: string): { fit: 'strong' | 'partial' | 'poor' | 'unknown'; score: number } {
  const text = practiceAreas.toLowerCase();
  if (!text.trim()) return { fit: 'unknown', score: 5 };

  const hits = (list: string[]) => list.filter((t) => text.includes(t)).length;
  const strong = hits(STRONG_FIT);
  const partial = hits(PARTIAL_FIT);
  const poor = hits(POOR_FIT);

  // A generalist with one family-law string is not a family lawyer. Only call
  // it poor when the poor-fit signal actually dominates.
  if (poor > 0 && strong === 0 && partial === 0) return { fit: 'poor', score: 0 };
  if (poor > strong + partial) return { fit: 'poor', score: 1 };
  if (strong >= 2) return { fit: 'strong', score: 10 };
  if (strong === 1) return { fit: 'strong', score: 8 };
  if (partial > 0) return { fit: 'partial', score: 5 };
  return { fit: 'unknown', score: 4 };
}

/**
 * Seniority. Per the roadmap the buyer is the practitioner who pays for their
 * own tools and does their own research. That is junior-to-mid counsel. A KC
 * with a reader and a junior is not doing the 11pm database search.
 */
function scoreSeniority(yearOfCall: string, postNominals: string): { band: string; score: number } {
  const isSilk = /\b(KC|QC|SC)\b/.test(postNominals);
  const year = Number.parseInt(yearOfCall, 10);
  const thisYear = new Date().getFullYear();
  const years = Number.isFinite(year) ? thisYear - year : null;

  if (isSilk) return { band: 'silk', score: 2 };
  if (years === null) return { band: 'unknown', score: 5 };
  if (years <= 3) return { band: 'reader/very junior', score: 7 };
  if (years <= 12) return { band: 'junior (prime)', score: 10 };
  if (years <= 22) return { band: 'senior junior', score: 7 };
  return { band: 'very senior', score: 3 };
}

/** Regional sets carry Westlaw/Lexis per-head costs worst. */
function scoreRegion(region: string): number {
  switch (region) {
    case 'newcastle':
    case 'wollongong':
    case 'regional-nsw':
      return 4;
    case 'parramatta':
      return 3;
    default:
      return 2;
  }
}

/* ------------------------------- CSV --------------------------------- */

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(cell); cell = ''; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    if (ch === '\r') continue;
    cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }

  const [header, ...body] = rows.filter((r) => r.some((c) => c !== ''));
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  return `${columns.join(',')}\n${rows.map((r) => columns.map((c) => csvCell(r[c])).join(',')).join('\n')}\n`;
}

/* --------------------------- MX verification -------------------------- */

const mxCache = new Map<string, boolean>();

async function domainAcceptsMail(domain: string): Promise<boolean> {
  const cached = mxCache.get(domain);
  if (cached !== undefined) return cached;
  let ok = false;
  try {
    const records = await resolveMx(domain);
    ok = records.length > 0 && records.some((r) => r.exchange);
  } catch {
    ok = false;
  }
  mxCache.set(domain, ok);
  return ok;
}

/* -------------------------------- main -------------------------------- */

async function main() {
  const contactsPath = join(OUT_DIR, 'contacts.csv');
  if (!existsSync(contactsPath)) {
    console.error('No contacts.csv — run scrape-chambers.ts first.');
    process.exit(1);
  }

  const contacts = parseCsv(readFileSync(contactsPath, 'utf8'));
  console.log(`Loaded ${contacts.length} contacts.`);

  // Suppression: unsubscribes + prior sends + manual do-not-contact.
  const suppressed = new Set<string>();
  if (existsSync(SUPPRESSION_PATH)) {
    for (const r of parseCsv(readFileSync(SUPPRESSION_PATH, 'utf8'))) {
      if (r.email) suppressed.add(r.email.trim().toLowerCase());
    }
  }
  if (existsSync(SENT_LOG_PATH)) {
    for (const r of parseCsv(readFileSync(SENT_LOG_PATH, 'utf8'))) {
      if (r.email) suppressed.add(r.email.trim().toLowerCase());
    }
  }
  console.log(`Suppression list: ${suppressed.size} addresses.`);

  const domains = [...new Set(contacts.map((c) => (c.emailDomain || '').toLowerCase()).filter(Boolean))];
  console.log(`Checking MX for ${domains.length} domains…`);
  const mxResults = new Map<string, boolean>();
  for (const d of domains) mxResults.set(d, await domainAcceptsMail(d));
  const badDomains = [...mxResults.entries()].filter(([, ok]) => !ok).map(([d]) => d);
  if (badDomains.length) console.log(`  No MX (will be dropped): ${badDomains.join(', ')}`);

  const queue: Record<string, unknown>[] = [];
  const dropped: Record<string, unknown>[] = [];

  for (const c of contacts) {
    const email = (c.email || '').trim().toLowerCase();
    const drop = (reason: string) => dropped.push({ ...c, dropReason: reason });

    if (!email) { drop('no email'); continue; }
    if (suppressed.has(email)) { drop('suppressed (already sent or unsubscribed)'); continue; }
    if (!mxResults.get((c.emailDomain || '').toLowerCase())) { drop('domain has no MX record'); continue; }

    const fit = scoreFit(c.practiceAreas || '');
    if (fit.fit === 'poor') { drop(`corpus fit: poor (${c.practiceAreas})`); continue; }

    const seniority = scoreSeniority(c.yearOfCall || '', c.postNominals || '');
    const priority = fit.score * 2 + seniority.score + scoreRegion(c.region || '');

    queue.push({
      priority,
      firstName: c.firstName,
      lastName: c.lastName,
      postNominals: c.postNominals,
      email,
      chambersName: c.chambersName,
      region: c.region,
      yearOfCall: c.yearOfCall,
      seniorityBand: seniority.band,
      corpusFit: fit.fit,
      practiceAreas: c.practiceAreas,
      profileUrl: c.profileUrl,
      sourceUrl: c.sourceUrl,
      fetchedAt: c.fetchedAt,
    });
  }

  queue.sort((a, b) => (b.priority as number) - (a.priority as number));

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  writeFileSync(
    join(OUT_DIR, 'send-queue.csv'),
    toCsv(queue, [
      'priority', 'firstName', 'lastName', 'postNominals', 'email',
      'chambersName', 'region', 'yearOfCall', 'seniorityBand', 'corpusFit',
      'practiceAreas', 'profileUrl', 'sourceUrl', 'fetchedAt',
    ]),
    'utf8',
  );

  writeFileSync(
    join(OUT_DIR, 'dropped.csv'),
    toCsv(dropped, ['dropReason', 'firstName', 'lastName', 'email', 'chambersName', 'practiceAreas', 'sourceUrl']),
    'utf8',
  );

  if (!existsSync(SUPPRESSION_PATH)) {
    writeFileSync(SUPPRESSION_PATH, 'email,reason,date\n', 'utf8');
    console.log('Created empty suppression.csv — add unsubscribes here, one per line.');
  }
  if (!existsSync(SENT_LOG_PATH)) {
    writeFileSync(SENT_LOG_PATH, 'email,name,chambers,variant,sentDate,replied,outcome,notes\n', 'utf8');
    console.log('Created empty sent-log.csv — append a row every time you send.');
  }

  const byFit = (f: string) => queue.filter((q) => q.corpusFit === f).length;
  const byBand = (b: string) => queue.filter((q) => q.seniorityBand === b).length;

  console.log('\n───────────────────────────────────────────');
  console.log(`Send queue:   ${queue.length}`);
  console.log(`Dropped:      ${dropped.length}`);
  console.log(`\n  corpus fit — strong ${byFit('strong')} · partial ${byFit('partial')} · unknown ${byFit('unknown')}`);
  console.log(`  seniority  — junior(prime) ${byBand('junior (prime)')} · senior junior ${byBand('senior junior')} · silk ${byBand('silk')} · unknown ${byBand('unknown')}`);
  console.log(`\nAt 30/day the top ${Math.min(queue.length, 30 * 10)} rows are ~${Math.ceil(Math.min(queue.length, 300) / 30)} weeks of sending.`);
  console.log(`\nWritten to ${OUT_DIR}/send-queue.csv`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
