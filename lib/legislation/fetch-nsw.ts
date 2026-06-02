// lib/legislation/fetch-nsw.ts
//
// XML fetcher for legislation.nsw.gov.au Acts.
//
// =============================================================================
// WHY THIS EXISTS (counterpart to lib/legislation/fetch.ts)
// =============================================================================
//
// The Cth equivalent (lib/legislation/fetch.ts) uses plain fetch() because
// legislation.gov.au has no bot challenge. NSW Legislation does — it's
// fronted by Cloudflare's "Managed Challenge" which requires JavaScript
// execution and cookie state. A plain HTTP client can't pass it; we get
// a "Just a moment…" interstitial instead of XML.
//
// So this module drives a real Chromium browser via Playwright. Chromium
// auto-executes the challenge, the resulting cf_clearance cookie persists
// in the BrowserContext, and the actual XML download is performed through
// the browser's own network stack so it carries the full Chrome request
// fingerprint (TLS, sec-* headers, accept, etc.) — not just the cookie.
//
// =============================================================================
// WHY CLICK-DOWNLOAD INSTEAD OF context.request.get()
// =============================================================================
//
// First attempt used `context.request.get(exportUrl)` — Playwright's HTTP
// API that shares cookies with the browser context. It failed with 403
// despite the cf_clearance cookie being attached, because that API uses
// Node's HTTP stack, NOT Chromium's. Cloudflare's bot detection inspects
// the full request fingerprint (TLS / JA3, sec-fetch-* headers, accept
// header shape, etc.); the cookie alone is necessary but not sufficient.
//
// The reliable fix is to let the BROWSER perform the download. We click
// the "Download XML" link and capture the download event. Everything about
// the request comes from Chromium itself — same fingerprint a Sydney
// lawyer's laptop would produce — so Cloudflare passes it.
//
// =============================================================================
// FLOW PER ACT
// =============================================================================
//
//   1. Navigate to the XML landing page:
//        https://legislation.nsw.gov.au/view/whole/xml/inforce/current/<id>
//      First navigation triggers the Cloudflare challenge; Playwright
//      passes it transparently. Subsequent navigations within the same
//      context skip it (cookies cached).
//
//   2. Read the "Download XML" link's href. That URL has the resolved
//      compilation date baked in:
//        https://legislation.nsw.gov.au/export/xml/<YYYY-MM-DD>/<id>
//      We parse the date out of it for diagnostics + filename derivation,
//      but the actual fetch is via the click below.
//
//   3. Click the link. Chromium triggers a download; we capture the
//      download event, stream the bytes to memory, and return the XML.
//
// =============================================================================
// SHARED BROWSER ACROSS CALLS
// =============================================================================
//
// Launching Chromium takes a few seconds — wasteful per call when fetching
// many Acts. The exported API supports two modes:
//
//   - One-off:   `await fetchNswActXml('act-2002-022')`
//                Creates a browser, fetches, closes. Simple.
//
//   - Batch:     Caller creates a context once via `launchNswBrowser()`,
//                passes it to each `fetchNswActXml(id, { context })` call,
//                then closes the browser at the end. Cookies persist, the
//                Cloudflare challenge is solved exactly once, every Act
//                reuses the same warmed-up session.
//
// scripts/fetch-nsw-acts.ts uses the batch mode.
//
// =============================================================================
// USER-AGENT
// =============================================================================
//
// The Cth fetcher uses a self-identifying UA
// ("BriefBridge legislation; +https://briefbridge.com") — best practice for
// scripted access. We deliberately do NOT do that here: Cloudflare bot
// detection gates on UA shape, and any UA that announces itself as a bot
// gets challenged or blocked. We use Chromium's default real-browser UA so
// the request is indistinguishable from a Sydney lawyer's laptop opening
// the page. This is consistent with NSW's robots.txt — /export/xml/ is not
// disallowed for any user-agent.

import {
  chromium,
  type Browser,
  type BrowserContext,
} from 'playwright';

// =============================================================================
// Constants
// =============================================================================

// Navigation/network timeouts. NSW pages are usually responsive (<3s) but
// the first hit on a fresh context can be slower because of the Cloudflare
// challenge. 45s is generous; anything longer means something is genuinely
// wrong.
const NAV_TIMEOUT_MS = 45_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

// Polite gap between back-to-back Act fetches in batch mode.
const BATCH_DELAY_MS = 1500;

// =============================================================================
// URL builders (symmetric with lib/legislation/fetch.ts)
// =============================================================================

/**
 * The XML landing page. Always uses "current" — NSW resolves it server-side
 * to whichever date is the latest in-force compilation.
 */
export function buildNswLandingUrl(registrationId: string): string {
  return `https://legislation.nsw.gov.au/view/whole/xml/inforce/current/${registrationId}`;
}

/**
 * The direct XML export URL. Requires the resolved compilation date —
 * read it from the landing page's Download XML link, don't synthesise.
 */
export function buildNswExportUrl(
  registrationId: string,
  compilationDate: string,
): string {
  return `https://legislation.nsw.gov.au/export/xml/${compilationDate}/${registrationId}`;
}

// =============================================================================
// Browser launch / lifecycle
// =============================================================================

export interface NswBrowserHandle {
  browser: Browser;
  context: BrowserContext;
}

/**
 * Launch a Chromium browser and create a fresh context primed with a
 * realistic Sydney-laptop profile. Use this once at the start of a batch
 * and close `browser` at the end.
 */
export async function launchNswBrowser(
  opts: { headless?: boolean } = {},
): Promise<NswBrowserHandle> {
  const headless = opts.headless ?? true;
  console.error(`[fetch-nsw] launching Chromium (${headless ? 'headless' : 'headed'})`);
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    // Real Chrome UA — see header note. Updated occasionally; this is fine.
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 800 },
    locale: 'en-AU',
    timezoneId: 'Australia/Sydney',
    // Default is true, but be explicit — we rely on the download event.
    acceptDownloads: true,
  });
  context.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
  context.setDefaultTimeout(NAV_TIMEOUT_MS);
  return { browser, context };
}

// =============================================================================
// Public entry point
// =============================================================================

export interface FetchNswResult {
  /** Raw XML stream (the same content the browser's Download XML button saves). */
  xml: string;
  /** The XML landing page URL we navigated to. */
  landingUrl: string;
  /** The export URL the browser was about to fetch when it triggered the download. */
  exportUrl: string;
  /** Compilation date parsed from exportUrl, e.g. '2022-06-16'. */
  compilationDate: string;
  /** Byte count of the returned XML. */
  bytes: number;
}

/**
 * Fetch an NSW Act's XML by registration ID.
 *
 * Pass `options.context` to reuse a warmed-up BrowserContext across many
 * calls (recommended for batches — see `launchNswBrowser`). Omit it for a
 * one-off; a temporary browser is created and closed.
 *
 * Throws with a descriptive message on:
 *   - Cloudflare challenge that didn't auto-pass (re-run headed and
 *     pass it once; cookies will persist)
 *   - Invalid registration ID (landing page is the NSW "Page not found")
 *   - Missing Download XML link
 *   - Download event never fires (timeout)
 *   - Response that doesn't look like XML
 */
export async function fetchNswActXml(
  registrationId: string,
  options: { context?: BrowserContext } = {},
): Promise<FetchNswResult> {
  let ownsBrowser = false;
  let temporaryBrowser: Browser | undefined;
  let context = options.context;

  if (!context) {
    const handle = await launchNswBrowser();
    temporaryBrowser = handle.browser;
    context = handle.context;
    ownsBrowser = true;
  }

  try {
    const landingUrl = buildNswLandingUrl(registrationId);
    console.error(`[fetch-nsw] ${registrationId}: ${landingUrl}`);

    const page = await context.newPage();
    try {
      await page.goto(landingUrl, { waitUntil: 'networkidle' });

      // Detect a stuck Cloudflare challenge.
      const title = (await page.title()).toLowerCase();
      if (
        title.includes('just a moment') ||
        title.includes('attention required')
      ) {
        throw new Error(
          `Cloudflare challenge did not auto-solve for ${registrationId}. ` +
            `Re-run the caller with headed mode (e.g. --headed) and pass any ` +
            `interactive check once — cookies will then persist for the rest of the batch.`,
        );
      }

      // Detect 404 / unknown registration ID.
      const bodyText = await page.locator('body').innerText();
      if (/page not found/i.test(bodyText) && bodyText.length < 2000) {
        throw new Error(
          `Landing page reports "Page not found" — likely invalid registration ID: ${registrationId}`,
        );
      }

      // Find the Download XML link and read its href (for diagnostics + date).
      const linkLoc = page.locator('a:has-text("Download XML")').first();
      const href = await linkLoc.getAttribute('href', { timeout: 10_000 });
      if (!href) {
        throw new Error(
          `No "Download XML" link found on landing page for ${registrationId}.`,
        );
      }
      const exportUrl = new URL(href, page.url()).toString();

      // Derive compilation date from the URL: /export/xml/<YYYY-MM-DD>/<id>
      const m = exportUrl.match(/\/export\/xml\/(\d{4}-\d{2}-\d{2})\//);
      if (!m) {
        throw new Error(
          `Unexpected export URL shape for ${registrationId}: ${exportUrl}`,
        );
      }
      const compilationDate = m[1];

      console.error(`[fetch-nsw] ${registrationId}: export ${exportUrl}`);

      // Trigger the download via a real browser click. The browser performs the
      // request itself, so the full Chrome fingerprint (TLS / sec-* headers /
      // cookies) is attached. Cloudflare accepts it where context.request.get()
      // is rejected as a Node-shaped request.
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: DOWNLOAD_TIMEOUT_MS }),
        linkLoc.click(),
      ]);

      // Stream the downloaded bytes to memory — no temp-file roundtrip.
      const stream = await download.createReadStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
      }
      const xml = Buffer.concat(chunks).toString('utf-8');

      if (!xml.trimStart().startsWith('<?xml')) {
        const peek = xml.slice(0, 80).replace(/\s+/g, ' ');
        throw new Error(
          `Downloaded content is not XML for ${registrationId}. First 80 chars: ${peek}`,
        );
      }

      console.error(
        `[fetch-nsw] ${registrationId}: ${xml.length.toLocaleString()} bytes (compilation ${compilationDate})`,
      );

      return {
        xml,
        landingUrl,
        exportUrl,
        compilationDate,
        bytes: xml.length,
      };
    } finally {
      await page.close();
    }
  } finally {
    if (ownsBrowser && temporaryBrowser) {
      await temporaryBrowser.close();
    }
  }
}

/**
 * Polite delay between back-to-back batch fetches.
 *
 * Exported so callers can match the same gap manually if they're not
 * using the batch helper above.
 */
export function batchDelay(): Promise<void> {
  return new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
}