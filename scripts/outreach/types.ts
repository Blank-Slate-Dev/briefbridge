// scripts/outreach/types.ts
//
// Shared types for the chambers outreach list builder.

/** How a chambers site exposes barrister email addresses. */
export type EmailExposure =
  | 'listing' // addresses appear on the index page itself — cheapest crawl
  | 'listing-cf' // on the index but Cloudflare-obfuscated (data-cfemail)
  | 'profile' // only on the individual profile page — needs a second hop
  | 'clerk-only' // index shows the clerk; profiles usually still have direct emails
  | 'none' // site publishes no email at all (phone/form only)
  | 'unknown';

export type Renderer = 'static' | 'js';

export type Region =
  | 'sydney-cbd'
  | 'parramatta'
  | 'newcastle'
  | 'wollongong'
  | 'regional-nsw';

export interface ChambersTarget {
  /** Stable identifier used in output rows and the suppression list. */
  slug: string;
  name: string;
  /** Root origin, no trailing slash. */
  url: string;
  /**
   * Paths to the barrister index. Several sets split the list across
   * /barristers/ and /counsel/, or paginate — list every entry point.
   */
  listingPaths: string[];
  /**
   * Regex (source string) matching profile URLs on this site. Applied to the
   * pathname only. Kept as a string so the registry stays JSON-serialisable.
   */
  profilePattern: string;
  region: Region;
  approxCount?: number;
  emailExposure: EmailExposure;
  renderer: Renderer;
  /** Practice specialisms, where the set has a clear focus. */
  focus?: string[];
  notes?: string;
  /**
   * Set true to skip. Used for sites with no browsable index, no website, or
   * a robots.txt that disallows us — kept in the registry so the reason is
   * recorded rather than silently dropped.
   */
  skip?: boolean;
  skipReason?: string;
}

export interface ScrapedContact {
  chambersSlug: string;
  chambersName: string;
  region: Region;
  name: string;
  firstName: string;
  lastName: string;
  postNominals: string; // KC / SC / etc, if detected
  email: string;
  emailDomain: string;
  phone: string;
  practiceAreas: string[];
  yearOfCall: string; // string not number — sites write "Admitted 1998", "2016 (Silk)"
  silkYear: string;
  profileUrl: string;
  /** Page the address was actually read from — the inferred-consent audit trail. */
  sourceUrl: string;
  fetchedAt: string; // ISO date
  /**
   * True when the source page carries a notice refusing unsolicited commercial
   * email. Under Spam Act 2003 Sch 2 cl 4(2)(d) this defeats inferred consent,
   * so these rows must never be emailed.
   */
  optOutNoticeFound: boolean;
  optOutNoticeText: string;
}

export interface CrawlStats {
  chambersSlug: string;
  listingPagesFetched: number;
  profilesFetched: number;
  contactsFound: number;
  optOutBlocked: number;
  errors: string[];
  robotsDisallowed: boolean;
  skipped: boolean;
  skipReason?: string;
}
