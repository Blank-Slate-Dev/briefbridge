// scripts/outreach/lib/http.ts
//
// Polite HTTP client for the chambers crawl.
//
// Design rules, in priority order:
//   1. robots.txt is authoritative. If it disallows the path for our UA or *,
//      we do not fetch it. No exceptions, no "but it's public".
//   2. One request at a time per host, with a real delay between them. A
//      barristers' chambers site is a small WordPress box, not a CDN.
//   3. Honest User-Agent with a contact URL. If a clerk wants to know who is
//      reading their site, the answer is in their access log.
//   4. Back off on 429/503 rather than hammering. HB Higgins in particular
//      rate-limits aggressively.

const CONTACT_URL = process.env.OUTREACH_CONTACT_URL ?? 'https://briefbridge.ai';
export const USER_AGENT = `BriefBridgeResearchBot/1.0 (+${CONTACT_URL}; contact: oakley@briefbridge.ai)`;

/** Baseline politeness delay between requests to the same host. */
const DEFAULT_DELAY_MS = 2500;

/** Hosts that need extra room. */
const HOST_DELAY_OVERRIDES: Record<string, number> = {
  'www.hbhiggins.com.au': 8000,
  'www.siranthonymason.com.au': 5000,
  'www.denmanchambers.com.au': 5000,
  'ebc44.com': 5000,
};

const MAX_RETRIES = 3;
const REQUEST_TIMEOUT_MS = 25_000;

const lastRequestAt = new Map<string, number>();
const robotsCache = new Map<string, RobotsRules>();

interface RobotsRules {
  /** Disallow path prefixes that apply to us. */
  disallow: string[];
  allow: string[];
  crawlDelayMs: number | null;
  /** True when robots.txt could not be read — we then assume permissive. */
  unavailable: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(ms: number): number {
  // ±25%, so we are not a metronome in someone's access log.
  return Math.round(ms * (0.75 + Math.random() * 0.5));
}

async function throttle(host: string, extraDelayMs = 0): Promise<void> {
  const base = HOST_DELAY_OVERRIDES[host] ?? DEFAULT_DELAY_MS;
  const delay = jitter(Math.max(base, extraDelayMs));
  const last = lastRequestAt.get(host);
  if (last !== undefined) {
    const elapsed = Date.now() - last;
    if (elapsed < delay) await sleep(delay - elapsed);
  }
  lastRequestAt.set(host, Date.now());
}

async function rawFetch(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-AU,en;q=0.9',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parse robots.txt into the rules that apply to us. We collect rules from both
 * the wildcard group and any group naming our UA, and take the union of
 * Disallow — i.e. we obey the stricter reading.
 */
function parseRobots(text: string): RobotsRules {
  const rules: RobotsRules = { disallow: [], allow: [], crawlDelayMs: null, unavailable: false };
  let applies = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      const ua = value.toLowerCase();
      applies = ua === '*' || USER_AGENT.toLowerCase().includes(ua) || ua.includes('briefbridge');
      continue;
    }
    if (!applies) continue;

    if (field === 'disallow' && value) rules.disallow.push(value);
    else if (field === 'allow' && value) rules.allow.push(value);
    else if (field === 'crawl-delay') {
      const secs = Number.parseFloat(value);
      if (Number.isFinite(secs)) rules.crawlDelayMs = Math.round(secs * 1000);
    }
  }
  return rules;
}

export async function getRobots(origin: string): Promise<RobotsRules> {
  const cached = robotsCache.get(origin);
  if (cached) return cached;

  const host = new URL(origin).host;
  let rules: RobotsRules;
  try {
    await throttle(host);
    const res = await rawFetch(`${origin}/robots.txt`);
    if (res.status === 200) {
      rules = parseRobots(await res.text());
    } else {
      // 404 means no restrictions. 4xx/5xx otherwise: treat as permissive but
      // flag it, and the caller's own rate limiting still applies.
      rules = { disallow: [], allow: [], crawlDelayMs: null, unavailable: res.status !== 404 };
    }
  } catch {
    rules = { disallow: [], allow: [], crawlDelayMs: null, unavailable: true };
  }
  robotsCache.set(origin, rules);
  return rules;
}

/** Longest-match wins, Allow beats Disallow at equal length (RFC 9309). */
export function isAllowedByRobots(rules: RobotsRules, pathname: string): boolean {
  const match = (patterns: string[]): number => {
    let best = -1;
    for (const p of patterns) {
      const literal = p.replace(/\*$/, '');
      if (pathname.startsWith(literal) && literal.length > best) best = literal.length;
    }
    return best;
  };
  const dis = match(rules.disallow);
  if (dis === -1) return true;
  return match(rules.allow) >= dis;
}

export interface FetchResult {
  ok: boolean;
  status: number;
  html: string;
  finalUrl: string;
  error?: string;
  robotsBlocked?: boolean;
}

/**
 * Fetch a page, obeying robots.txt, per-host throttling and backoff.
 * Returns a result object rather than throwing — a crawl over 70 small sites
 * will always have a few failures and they should not abort the run.
 */
export async function politeFetch(url: string): Promise<FetchResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, status: 0, html: '', finalUrl: url, error: 'invalid URL' };
  }

  const rules = await getRobots(parsed.origin);
  if (!isAllowedByRobots(rules, parsed.pathname)) {
    return {
      ok: false,
      status: 0,
      html: '',
      finalUrl: url,
      error: 'disallowed by robots.txt',
      robotsBlocked: true,
    };
  }

  let lastError = '';
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      await throttle(parsed.host, rules.crawlDelayMs ?? 0);
      const res = await rawFetch(url);

      if (res.status === 429 || res.status === 503) {
        const retryAfter = Number.parseInt(res.headers.get('retry-after') ?? '', 10);
        const waitMs = Number.isFinite(retryAfter)
          ? retryAfter * 1000
          : 5000 * 2 ** attempt;
        lastError = `HTTP ${res.status}`;
        if (attempt < MAX_RETRIES) {
          await sleep(Math.min(waitMs, 60_000));
          continue;
        }
        return { ok: false, status: res.status, html: '', finalUrl: url, error: lastError };
      }

      if (!res.ok) {
        return { ok: false, status: res.status, html: '', finalUrl: url, error: `HTTP ${res.status}` };
      }

      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('html') && !contentType.includes('xml')) {
        return { ok: false, status: res.status, html: '', finalUrl: url, error: `non-HTML (${contentType})` };
      }

      return { ok: true, status: res.status, html: await res.text(), finalUrl: res.url || url };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_RETRIES) await sleep(3000 * 2 ** attempt);
    }
  }
  return { ok: false, status: 0, html: '', finalUrl: url, error: lastError || 'fetch failed' };
}

/**
 * Render a JS-heavy page with Playwright (already a devDependency).
 * Only used for chambers whose registry entry sets renderer: 'js'.
 * robots.txt is still checked first — a headless browser does not change
 * what we are permitted to read.
 */
export async function renderFetch(url: string): Promise<FetchResult> {
  const parsed = new URL(url);
  const rules = await getRobots(parsed.origin);
  if (!isAllowedByRobots(rules, parsed.pathname)) {
    return { ok: false, status: 0, html: '', finalUrl: url, error: 'disallowed by robots.txt', robotsBlocked: true };
  }

  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ userAgent: USER_AGENT, locale: 'en-AU' });
    const page = await context.newPage();
    await throttle(parsed.host, rules.crawlDelayMs ?? 0);
    await page.goto(url, { waitUntil: 'networkidle', timeout: REQUEST_TIMEOUT_MS });
    // Nudge lazy-loaded lists (Sixth Floor's "Loading.." index).
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2500);
    const html = await page.content();
    return { ok: true, status: 200, html, finalUrl: page.url() };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      html: '',
      finalUrl: url,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await browser.close();
  }
}
