// scripts/outreach/scrape-chambers.ts
//
// Builds the NSW barristers outreach list from chambers' own websites.
//
//   npx tsx scripts/outreach/scrape-chambers.ts
//   npx tsx scripts/outreach/scrape-chambers.ts --only=banco,eleven-wentworth
//   npx tsx scripts/outreach/scrape-chambers.ts --region=newcastle
//   npx tsx scripts/outreach/scrape-chambers.ts --limit=5 --dry-run
//
// Outputs to scripts/outreach/out/:
//   contacts.csv        — sendable rows
//   excluded.csv        — rows excluded, with the reason (audit trail)
//   crawl-report.json   — per-chambers stats, errors, robots decisions
//
// This is deliberately slow. Roughly 2.5s between requests to the same host,
// longer where a site has asked for it. A full run over ~70 sets takes a few
// hours. Leave it running; do not lower the delay.

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ACTIVE_CHAMBERS, CHAMBERS } from './chambers-registry';
import type { ChambersTarget, ScrapedContact, CrawlStats } from './types';
import { politeFetch, renderFetch } from './lib/http';
import {
  detectOptOutNotice,
  extractEmails,
  extractPracticeAreas,
  extractPhone,
  extractYearOfCall,
  findProfileLinks,
  findProfileName,
  parseName,
} from './lib/extract';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'out');

interface ExcludedRow {
  chambersSlug: string;
  email: string;
  name: string;
  sourceUrl: string;
  reason: string;
  detail: string;
}

/* ------------------------------- args -------------------------------- */

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined =>
    args.find((a) => a.startsWith(`--${flag}=`))?.split('=').slice(1).join('=');

  return {
    only: get('only')?.split(',').map((s) => s.trim()).filter(Boolean),
    region: get('region'),
    limit: get('limit') ? Number.parseInt(get('limit')!, 10) : undefined,
    dryRun: args.includes('--dry-run'),
    maxProfiles: get('max-profiles') ? Number.parseInt(get('max-profiles')!, 10) : undefined,
  };
}

/* ------------------------------ crawling ----------------------------- */

async function fetchPage(target: ChambersTarget, url: string) {
  return target.renderer === 'js' ? renderFetch(url) : politeFetch(url);
}

async function crawlChambers(
  target: ChambersTarget,
  opts: { maxProfiles?: number; dryRun?: boolean },
): Promise<{ contacts: ScrapedContact[]; excluded: ExcludedRow[]; stats: CrawlStats }> {
  const stats: CrawlStats = {
    chambersSlug: target.slug,
    listingPagesFetched: 0,
    profilesFetched: 0,
    contactsFound: 0,
    optOutBlocked: 0,
    errors: [],
    robotsDisallowed: false,
    skipped: false,
  };
  const contacts: ScrapedContact[] = [];
  const excluded: ExcludedRow[] = [];
  const now = new Date().toISOString().slice(0, 10);
  const emailDomain = new URL(target.url).host.replace(/^www\./, '');

  const profileUrls = new Set<string>();
  const listingHtml: Array<{ url: string; html: string }> = [];

  // --- pass 1: listing pages -----------------------------------------
  for (const path of target.listingPaths) {
    const url = `${target.url}${path}`;
    const res = await fetchPage(target, url);
    if (!res.ok) {
      if (res.robotsBlocked) {
        stats.robotsDisallowed = true;
        stats.errors.push(`listing ${path}: disallowed by robots.txt — skipping this set`);
        return { contacts, excluded, stats };
      }
      stats.errors.push(`listing ${path}: ${res.error}`);
      continue;
    }
    stats.listingPagesFetched += 1;
    listingHtml.push({ url: res.finalUrl, html: res.html });

    for (const link of findProfileLinks(res.html, res.finalUrl, target.profilePattern)) {
      profileUrls.add(link);
    }

    // Follow WordPress-style pagination (2 Selborne is 9/page).
    for (let page = 2; page <= 12; page += 1) {
      const pagedUrl = `${target.url}${path.replace(/\/$/, '')}/page/${page}/`;
      const paged = await politeFetch(pagedUrl);
      if (!paged.ok) break;
      const links = findProfileLinks(paged.html, paged.finalUrl, target.profilePattern);
      if (links.length === 0) break;
      stats.listingPagesFetched += 1;
      listingHtml.push({ url: paged.finalUrl, html: paged.html });
      links.forEach((l) => profileUrls.add(l));
    }
  }

  // --- listing-level emails (Tier 1 sets) -----------------------------
  // Cheapest possible extraction: some sets put every address on the index.
  // We still take the profile hop afterwards for name/practice-area context,
  // but if profiles fail we already have the addresses.
  const listingEmailIndex = new Map<string, string>(); // email -> listing URL
  if (target.emailExposure === 'listing' || target.emailExposure === 'listing-cf') {
    for (const { url, html } of listingHtml) {
      const optOut = detectOptOutNotice(html);
      const { personal } = extractEmails(html, emailDomain);
      for (const email of personal) {
        if (optOut.found) {
          stats.optOutBlocked += 1;
          excluded.push({
            chambersSlug: target.slug, email, name: '', sourceUrl: url,
            reason: 'opt-out notice on source page (Spam Act Sch 2 cl 4(2)(d))',
            detail: optOut.text,
          });
          continue;
        }
        if (!listingEmailIndex.has(email)) listingEmailIndex.set(email, url);
      }
    }
  }

  if (opts.dryRun) {
    stats.contactsFound = listingEmailIndex.size;
    stats.errors.push(`dry run: ${profileUrls.size} profile URLs discovered, not fetched`);
    return { contacts, excluded, stats };
  }

  // --- pass 2: profile pages ------------------------------------------
  const seenEmails = new Set<string>();
  const profileList = [...profileUrls].slice(0, opts.maxProfiles ?? Number.MAX_SAFE_INTEGER);

  for (const profileUrl of profileList) {
    const res = await fetchPage(target, profileUrl);
    if (!res.ok) {
      if (res.robotsBlocked) stats.robotsDisallowed = true;
      stats.errors.push(`profile ${profileUrl}: ${res.error}`);
      continue;
    }
    stats.profilesFetched += 1;

    const nameRaw = findProfileName(res.html);
    const name = parseName(nameRaw);
    const optOut = detectOptOutNotice(res.html);
    const { personal } = extractEmails(res.html, emailDomain);
    const { yearOfCall, silkYear } = extractYearOfCall(res.html);
    const practiceAreas = extractPracticeAreas(res.html);
    const phone = extractPhone(res.html);

    if (personal.length === 0) {
      excluded.push({
        chambersSlug: target.slug, email: '', name: name.full, sourceUrl: res.finalUrl,
        reason: 'no personal email published on profile', detail: '',
      });
      continue;
    }

    // Prefer an address whose local part echoes the surname — guards against
    // picking up an unrelated address that happens to sit in the footer.
    const surname = name.lastName.toLowerCase();
    const best =
      personal.find((e) => surname && e.split('@')[0].toLowerCase().includes(surname)) ??
      personal[0];

    if (optOut.found) {
      stats.optOutBlocked += 1;
      excluded.push({
        chambersSlug: target.slug, email: best, name: name.full, sourceUrl: res.finalUrl,
        reason: 'opt-out notice on source page (Spam Act Sch 2 cl 4(2)(d))',
        detail: optOut.text,
      });
      continue;
    }

    if (seenEmails.has(best)) continue;
    seenEmails.add(best);
    listingEmailIndex.delete(best);

    contacts.push({
      chambersSlug: target.slug,
      chambersName: target.name,
      region: target.region,
      name: name.full,
      firstName: name.firstName,
      lastName: name.lastName,
      postNominals: name.postNominals,
      email: best,
      emailDomain: best.split('@')[1] ?? '',
      phone,
      practiceAreas,
      yearOfCall,
      silkYear,
      profileUrl: res.finalUrl,
      sourceUrl: res.finalUrl,
      fetchedAt: now,
      optOutNoticeFound: false,
      optOutNoticeText: '',
    });
  }

  // --- anything found only on the listing, never matched to a profile --
  for (const [email, sourceUrl] of listingEmailIndex) {
    if (seenEmails.has(email)) continue;
    contacts.push({
      chambersSlug: target.slug,
      chambersName: target.name,
      region: target.region,
      name: '',
      firstName: '',
      lastName: '',
      postNominals: '',
      email,
      emailDomain: email.split('@')[1] ?? '',
      phone: '',
      practiceAreas: [],
      yearOfCall: '',
      silkYear: '',
      profileUrl: '',
      sourceUrl,
      fetchedAt: now,
      optOutNoticeFound: false,
      optOutNoticeText: '',
    });
  }

  stats.contactsFound = contacts.length;
  return { contacts, excluded, stats };
}

/* -------------------------------- CSV -------------------------------- */

function csvCell(v: unknown): string {
  const s = Array.isArray(v) ? v.join('; ') : String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv<T extends Record<string, unknown>>(rows: T[], columns: (keyof T)[]): string {
  const header = columns.map((c) => csvCell(String(c))).join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(r[c])).join(',')).join('\n');
  return `${header}\n${body}\n`;
}

/* -------------------------------- main ------------------------------- */

async function main() {
  const opts = parseArgs();

  let targets = ACTIVE_CHAMBERS;
  if (opts.only) targets = targets.filter((c) => opts.only!.includes(c.slug));
  if (opts.region) targets = targets.filter((c) => c.region === opts.region);
  if (opts.limit) targets = targets.slice(0, opts.limit);

  if (targets.length === 0) {
    console.error('No chambers matched those filters.');
    console.error(`Known slugs: ${CHAMBERS.map((c) => c.slug).join(', ')}`);
    process.exit(1);
  }

  console.log(`Crawling ${targets.length} chambers${opts.dryRun ? ' (dry run)' : ''}.`);
  console.log('This is rate-limited on purpose. Expect hours, not minutes.\n');

  const allContacts: ScrapedContact[] = [];
  const allExcluded: ExcludedRow[] = [];
  const allStats: CrawlStats[] = [];

  for (const [i, target] of targets.entries()) {
    process.stdout.write(`[${i + 1}/${targets.length}] ${target.name} … `);
    try {
      const { contacts, excluded, stats } = await crawlChambers(target, opts);
      allContacts.push(...contacts);
      allExcluded.push(...excluded);
      allStats.push(stats);
      const flags = [
        stats.robotsDisallowed ? 'ROBOTS-BLOCKED' : '',
        stats.optOutBlocked ? `${stats.optOutBlocked} opt-out` : '',
        stats.errors.length ? `${stats.errors.length} err` : '',
      ].filter(Boolean).join(', ');
      console.log(`${stats.contactsFound} contacts${flags ? ` (${flags})` : ''}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`FAILED — ${message}`);
      allStats.push({
        chambersSlug: target.slug, listingPagesFetched: 0, profilesFetched: 0,
        contactsFound: 0, optOutBlocked: 0, errors: [message],
        robotsDisallowed: false, skipped: false,
      });
    }
  }

  // Global dedupe — a barrister can appear on two sets' sites.
  const byEmail = new Map<string, ScrapedContact>();
  for (const c of allContacts) {
    const existing = byEmail.get(c.email);
    // Prefer the richer row.
    if (!existing || (!existing.name && c.name) || c.practiceAreas.length > existing.practiceAreas.length) {
      byEmail.set(c.email, c);
    }
  }
  const deduped = [...byEmail.values()];

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  writeFileSync(
    join(OUT_DIR, 'contacts.csv'),
    toCsv(deduped as unknown as Record<string, unknown>[], [
      'firstName', 'lastName', 'postNominals', 'name', 'email', 'emailDomain',
      'chambersName', 'chambersSlug', 'region', 'yearOfCall', 'silkYear',
      'practiceAreas', 'phone', 'profileUrl', 'sourceUrl', 'fetchedAt',
    ]),
    'utf8',
  );

  writeFileSync(
    join(OUT_DIR, 'excluded.csv'),
    toCsv(allExcluded as unknown as Record<string, unknown>[], [
      'chambersSlug', 'name', 'email', 'reason', 'detail', 'sourceUrl',
    ]),
    'utf8',
  );

  writeFileSync(
    join(OUT_DIR, 'crawl-report.json'),
    JSON.stringify(
      {
        runAt: new Date().toISOString(),
        chambersAttempted: targets.length,
        contactsBeforeDedupe: allContacts.length,
        contactsAfterDedupe: deduped.length,
        excludedRows: allExcluded.length,
        optOutBlockedTotal: allStats.reduce((n, s) => n + s.optOutBlocked, 0),
        robotsBlockedSets: allStats.filter((s) => s.robotsDisallowed).map((s) => s.chambersSlug),
        perChambers: allStats,
      },
      null,
      2,
    ),
    'utf8',
  );

  const optOutTotal = allStats.reduce((n, s) => n + s.optOutBlocked, 0);
  const robotsBlocked = allStats.filter((s) => s.robotsDisallowed);

  console.log('\n───────────────────────────────────────────');
  console.log(`Contacts (deduped):  ${deduped.length}`);
  console.log(`Excluded rows:       ${allExcluded.length}`);
  console.log(`Opt-out notices hit: ${optOutTotal}`);
  console.log(`Robots-blocked sets: ${robotsBlocked.length}${robotsBlocked.length ? ` (${robotsBlocked.map((s) => s.chambersSlug).join(', ')})` : ''}`);
  console.log(`\nWritten to ${OUT_DIR}`);
  console.log('\nNext: npx tsx scripts/outreach/verify-list.ts');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
