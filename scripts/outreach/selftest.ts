import { decodeCloudflareEmail, detectOptOutNotice, parseName, extractEmails, extractYearOfCall, findProfileLinks } from './lib/extract';
import { isAllowedByRobots } from './lib/http';

let pass = 0, fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};

// --- Cloudflare decode: encode "clerk@banco.net.au" with key 0x5a
const target = 'clerk@banco.net.au';
const key = 0x5a;
const hex = [key, ...[...target].map(c => c.charCodeAt(0) ^ key)]
  .map(n => n.toString(16).padStart(2, '0')).join('');
eq('decodeCloudflareEmail round-trip', decodeCloudflareEmail(hex), target);
eq('decodeCloudflareEmail garbage', decodeCloudflareEmail('zz'), '');

// --- opt-out detection (Spam Act Sch 2 cl 4(2)(d))
eq('optOut: plain notice',
  detectOptOutNotice('<p>Please note we accept no unsolicited commercial emails at this address.</p>').found, true);
eq('optOut: "no marketing"',
  detectOptOutNotice('<div>Do not send marketing material to these addresses.</div>').found, true);
eq('optOut: not for marketing',
  detectOptOutNotice('<p>This address is not for the purposes of marketing.</p>').found, true);
eq('optOut: no canvassing',
  detectOptOutNotice('<footer>No canvassing.</footer>').found, true);
eq('optOut: ordinary page is clean',
  detectOptOutNotice('<p>Jane practises in commercial and equity. Email jane@x.com</p>').found, false);
eq('optOut: ignores script tags',
  detectOptOutNotice('<script>var s="no unsolicited emails"</script><p>hi</p>').found, false);

// --- names
eq('parseName: silk', parseName('The Hon. James Fletcher SC'),
  { full: 'James Fletcher', firstName: 'James', lastName: 'Fletcher', postNominals: 'SC' });
eq('parseName: multi-nominal', parseName('Margaret Allars AM KC'),
  { full: 'Margaret Allars', firstName: 'Margaret', lastName: 'Allars', postNominals: 'AM KC' });
eq('parseName: plain', parseName('  Alice   Zheng '),
  { full: 'Alice Zheng', firstName: 'Alice', lastName: 'Zheng', postNominals: '' });

// --- email extraction + classification
const html = `
  <a href="mailto:Agius@wardellchambers.com.au">email</a>
  <a href="mailto:clerk@wardellchambers.com.au">clerk</a>
  <a href="mailto:info@wardellchambers.com.au">info</a>
  <p>also j.smith@wardellchambers.com.au and logo.png@x</p>`;
const ex = extractEmails(html, 'wardellchambers.com.au');
eq('extractEmails personal', ex.personal.sort(), ['agius@wardellchambers.com.au','j.smith@wardellchambers.com.au']);
eq('extractEmails clerk', ex.clerk, ['clerk@wardellchambers.com.au']);
eq('extractEmails role', ex.role, ['info@wardellchambers.com.au']);

// --- year of call
eq('yearOfCall: called to the bar',
  extractYearOfCall('<p>Called to the Bar in 2011. Took silk in 2024.</p>'),
  { yearOfCall: '2011', silkYear: '2024' });
eq('yearOfCall: admitted',
  extractYearOfCall('<p>Admitted 1998</p>').yearOfCall, '1998');
eq('yearOfCall: absent',
  extractYearOfCall('<p>Commercial law.</p>'), { yearOfCall: '', silkYear: '' });

// --- profile link discovery is scoped to same host + pattern
const listing = `
  <a href="/barrister/jane-doe/">Jane</a>
  <a href="/barrister/john-roe/?x=1">John</a>
  <a href="/about/">About</a>
  <a href="https://elsewhere.com/barrister/evil/">Off-site</a>`;
eq('findProfileLinks', findProfileLinks(listing, 'https://banco.net.au/barristers/', '^/barrister/[a-z0-9-]+/?$').sort(),
  ['https://banco.net.au/barrister/jane-doe/', 'https://banco.net.au/barrister/john-roe/']);

// --- robots longest-match
const rules = { disallow: ['/private', '/'], allow: ['/barristers'], crawlDelayMs: null, unavailable: false };
eq('robots: allow beats shorter disallow', isAllowedByRobots(rules, '/barristers/jane'), true);
eq('robots: disallow deeper wins', isAllowedByRobots(rules, '/private/x'), false);
eq('robots: empty rules permit', isAllowedByRobots({ disallow: [], allow: [], crawlDelayMs: null, unavailable: false }, '/anything'), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
