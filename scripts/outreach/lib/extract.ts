// scripts/outreach/lib/extract.ts
//
// Extraction helpers. Uses cheerio, already a dependency of this repo.

import * as cheerio from 'cheerio';

/* ------------------------------------------------------------------ */
/* Opt-out notice detection — Spam Act 2003 (Cth) Sch 2 cl 4(2)(d)     */
/* ------------------------------------------------------------------ */

// Inferred consent from a published address is DEFEATED where the publication
// is accompanied by "a statement to the effect that the relevant electronic
// account-holder does not want to receive unsolicited commercial electronic
// messages at that electronic address ... or a statement to similar effect".
//
// So the presence of one of these on the page is not a soft signal to weigh
// up. It is the statutory off-switch. Any address on such a page is excluded
// from the sendable list, permanently.
const OPT_OUT_PATTERNS: RegExp[] = [
  /\bno\s+unsolicited\s+(commercial\s+)?(e-?mails?|messages?|communications?|approaches)/i,
  /\bunsolicited\s+(commercial\s+)?(e-?mails?|messages?)\s+(are\s+)?(not\s+welcome|will\s+not|are\s+not\s+accepted|prohibited)/i,
  /\bdo\s+not\s+(send|contact).{0,40}\b(marketing|promotional|sales|unsolicited)/i,
  /\bthis\s+(e-?mail\s+)?address\s+(is\s+not|must\s+not\s+be\s+used).{0,60}\b(marketing|solicitation|unsolicited)/i,
  /\bnot\s+for\s+(the\s+)?(purposes?\s+of\s+)?(marketing|solicitation|advertising)/i,
  /\bno\s+(cold\s+)?(calls?|callers?|canvassing|soliciting|solicitation)/i,
  /\bwe\s+do\s+not\s+(accept|welcome)\s+.{0,30}\b(marketing|sales|unsolicited)/i,
  /\bmarketing\s+(e-?mails?|approaches|enquiries)\s+(are\s+)?(not\s+welcome|will\s+be\s+(deleted|ignored))/i,
];

export interface OptOutFinding {
  found: boolean;
  text: string;
}

/**
 * Scan visible page text for a notice refusing unsolicited commercial email.
 * Returns the matched sentence so a human can review the call.
 */
export function detectOptOutNotice(html: string): OptOutFinding {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  const text = $.root().text().replace(/\s+/g, ' ');

  for (const pattern of OPT_OUT_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      const start = Math.max(0, match.index - 90);
      const end = Math.min(text.length, match.index + match[0].length + 90);
      return { found: true, text: text.slice(start, end).trim() };
    }
  }
  return { found: false, text: '' };
}

/* ------------------------------------------------------------------ */
/* Email extraction                                                    */
/* ------------------------------------------------------------------ */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Addresses that are not a person. */
const ROLE_LOCAL_PARTS = new Set([
  'info', 'admin', 'enquiries', 'enquiry', 'contact', 'reception', 'office',
  'mail', 'email', 'hello', 'support', 'accounts', 'billing', 'webmaster',
  'postmaster', 'noreply', 'no-reply', 'privacy', 'marketing', 'careers',
  'jobs', 'recruitment', 'media', 'press', 'general', 'admin1', 'bookings',
]);

/** Clerk addresses — real people, but gatekeepers, not the target. */
const CLERK_HINTS = [/^clerk/i, /clerk\d*$/i, /^clk$/i, /clerks?@/i, /^listing/i];

export function isRoleAddress(email: string): boolean {
  const local = email.split('@')[0].toLowerCase();
  return ROLE_LOCAL_PARTS.has(local);
}

export function isClerkAddress(email: string): boolean {
  const local = email.split('@')[0];
  return CLERK_HINTS.some((re) => re.test(local)) || /clerk/i.test(local);
}

/**
 * Cloudflare's email-obfuscation scheme (used by Greenway's listing).
 * data-cfemail is hex; the first byte is the XOR key for the rest.
 */
export function decodeCloudflareEmail(encoded: string): string {
  try {
    const key = Number.parseInt(encoded.slice(0, 2), 16);
    let out = '';
    for (let i = 2; i < encoded.length; i += 2) {
      out += String.fromCharCode(Number.parseInt(encoded.slice(i, i + 2), 16) ^ key);
    }
    return out;
  } catch {
    return '';
  }
}

/**
 * Pull every plausible address off a page: mailto: links, Cloudflare-protected
 * spans, and bare text. Deduped, lowercased, role/clerk addresses separated.
 */
export function extractEmails(html: string, restrictToDomain?: string): {
  personal: string[];
  clerk: string[];
  role: string[];
} {
  const $ = cheerio.load(html);
  const found = new Set<string>();

  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const addr = href.slice(7).split('?')[0].trim();
    if (addr) found.add(addr.toLowerCase());
  });

  $('[data-cfemail]').each((_, el) => {
    const decoded = decodeCloudflareEmail($(el).attr('data-cfemail') ?? '');
    if (decoded.includes('@')) found.add(decoded.toLowerCase());
  });

  // Cloudflare also encodes into /cdn-cgi/l/email-protection#<hex> hrefs.
  $('a[href*="/cdn-cgi/l/email-protection#"]').each((_, el) => {
    const hex = ($(el).attr('href') ?? '').split('#')[1] ?? '';
    const decoded = decodeCloudflareEmail(hex);
    if (decoded.includes('@')) found.add(decoded.toLowerCase());
  });

  $('script, style, noscript').remove();
  const text = $.root().text();
  for (const m of text.match(EMAIL_RE) ?? []) {
    found.add(m.toLowerCase());
  }

  const personal: string[] = [];
  const clerk: string[] = [];
  const role: string[] = [];

  for (const email of found) {
    // Strip artefacts like a trailing full stop glued on by prose.
    const clean = email.replace(/[.,;:]+$/, '');
    if (!/^[^@]+@[^@]+\.[a-z]{2,}$/i.test(clean)) continue;
    if (/\.(png|jpe?g|gif|webp|svg|css|js)$/i.test(clean)) continue;
    if (/^(example|test|your|name|user|someone)@/i.test(clean)) continue;
    if (restrictToDomain && !clean.endsWith(`@${restrictToDomain}`)) {
      // Keep foreign-domain addresses only if they look personal — some sets
      // publish members on @bigpond / @selbornechambers shared domains.
      if (isRoleAddress(clean)) continue;
    }
    if (isRoleAddress(clean)) role.push(clean);
    else if (isClerkAddress(clean)) clerk.push(clean);
    else personal.push(clean);
  }

  return { personal: [...new Set(personal)], clerk: [...new Set(clerk)], role: [...new Set(role)] };
}

/* ------------------------------------------------------------------ */
/* Name, seniority, year of call, practice areas                       */
/* ------------------------------------------------------------------ */

const POST_NOMINAL_RE = /\b(KC|QC|SC|AM|AO|OAM|ESM|PSM)\b/g;

export interface ParsedName {
  full: string;
  firstName: string;
  lastName: string;
  postNominals: string;
}

export function parseName(raw: string): ParsedName {
  let s = raw.replace(/\s+/g, ' ').trim();
  s = s.replace(/^(The\s+Hon(?:ourable)?\.?|Dr|Mr|Mrs|Ms|Miss|Prof(?:essor)?)\.?\s+/i, '');

  const nominals = [...new Set(s.match(POST_NOMINAL_RE) ?? [])].join(' ');
  const nameOnly = s.replace(POST_NOMINAL_RE, '').replace(/[,\s]+$/, '').trim();

  const parts = nameOnly.split(' ').filter(Boolean);
  return {
    full: nameOnly,
    firstName: parts[0] ?? '',
    lastName: parts.length > 1 ? parts[parts.length - 1] : '',
    postNominals: nominals,
  };
}

const YEAR_OF_CALL_PATTERNS: RegExp[] = [
  /(?:called\s+to\s+the\s+bar|call\s+to\s+the\s+bar|admitted\s+to\s+the\s+bar|year\s+of\s+call|at\s+the\s+bar\s+since|barrister\s+since)\D{0,20}(19\d{2}|20\d{2})/i,
  /\bbarrister[:\s]+(19\d{2}|20\d{2})\b/i,
  /\badmitted\D{0,30}(19\d{2}|20\d{2})/i,
  /\bcalled\D{0,20}(19\d{2}|20\d{2})/i,
];

const SILK_PATTERNS: RegExp[] = [
  /(?:silk|appointed\s+senior\s+counsel|took\s+silk|senior\s+counsel)\D{0,20}(19\d{2}|20\d{2})/i,
  /\bsilk[:\s]+(19\d{2}|20\d{2})\b/i,
];

export function extractYearOfCall(html: string): { yearOfCall: string; silkYear: string } {
  const $ = cheerio.load(html);
  $('script, style, noscript').remove();
  const text = $.root().text().replace(/\s+/g, ' ');

  let yearOfCall = '';
  for (const p of YEAR_OF_CALL_PATTERNS) {
    const m = p.exec(text);
    if (m?.[1]) { yearOfCall = m[1]; break; }
  }

  let silkYear = '';
  for (const p of SILK_PATTERNS) {
    const m = p.exec(text);
    if (m?.[1]) { silkYear = m[1]; break; }
  }

  return { yearOfCall, silkYear };
}

/**
 * Practice areas, from whichever of the common shapes the site uses:
 * a tagged list, a "Practice areas" heading followed by a list, or
 * link rels pointing at a practice-area taxonomy.
 */
export function extractPracticeAreas(html: string): string[] {
  const $ = cheerio.load(html);
  const areas = new Set<string>();

  $('a[href*="practice-area"], a[href*="practice_area"], a[href*="/expertise/"], a[href*="/areas/"]').each((_, el) => {
    const t = $(el).text().trim();
    if (t && t.length < 70) areas.add(t);
  });

  $('h1, h2, h3, h4, h5, strong, dt, .elementor-heading-title').each((_, el) => {
    const heading = $(el).text().trim().toLowerCase();
    if (!/^(practice\s+areas?|areas?\s+of\s+practice|expertise|specialis(?:t|ation)s?)\b/.test(heading)) return;

    let node = $(el).next();
    for (let hops = 0; hops < 3 && node.length; hops += 1) {
      if (node.is('ul, ol')) {
        node.find('li').each((__, li) => {
          const t = $(li).text().trim();
          if (t && t.length < 70) areas.add(t);
        });
        break;
      }
      if (node.is('p, div') && node.text().includes(',')) {
        for (const t of node.text().split(/[,;•|]/)) {
          const clean = t.trim();
          if (clean && clean.length < 70) areas.add(clean);
        }
        break;
      }
      node = node.next();
    }
  });

  return [...areas]
    .map((a) => a.replace(/\s+/g, ' ').trim())
    .filter((a) => a.length > 2 && !/^(read more|view profile|contact|home)$/i.test(a))
    .slice(0, 20);
}

export function extractPhone(html: string): string {
  const $ = cheerio.load(html);
  const tel = $('a[href^="tel:"]').first().attr('href');
  if (tel) return tel.slice(4).trim();

  $('script, style').remove();
  const m = /\b(?:\+?61\s?)?(?:\(0?[2-8]\)|0[2-8])[\s-]?\d{4}[\s-]?\d{4}\b/.exec($.root().text());
  return m ? m[0].replace(/\s+/g, ' ').trim() : '';
}

/** Discover profile links on a listing page, scoped by the registry regex. */
export function findProfileLinks(html: string, baseUrl: string, pattern: string): string[] {
  const $ = cheerio.load(html);
  const re = new RegExp(pattern);
  const out = new Set<string>();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    let abs: URL;
    try {
      abs = new URL(href, baseUrl);
    } catch {
      return;
    }
    if (abs.host !== new URL(baseUrl).host) return;
    if (!re.test(abs.pathname)) return;
    abs.hash = '';
    abs.search = '';
    out.add(abs.toString());
  });

  return [...out];
}

/** Best guess at the barrister's name on a profile page. */
export function findProfileName(html: string): string {
  const $ = cheerio.load(html);
  for (const sel of ['h1', '.entry-title', '.page-title', '.barrister-name', 'h2']) {
    const t = $(sel).first().text().trim();
    if (t && t.length < 80 && /[A-Za-z]/.test(t)) return t;
  }
  const title = $('title').text().split(/[|–—-]/)[0].trim();
  return title.length < 80 ? title : '';
}
