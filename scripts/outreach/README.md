# scripts/outreach

List building and cold outreach for BriefBridge, targeting NSW barristers.

```
scripts/outreach/
├── README.md              ← you are here
├── EMAIL-SETUP.md         ← Google Workspace + DNS. Do this first.
├── EMAILS.md              ← the four message variants and reply handling
├── chambers-registry.ts   ← ~70 NSW chambers with crawl patterns
├── scrape-chambers.ts     ← builds out/contacts.csv
├── verify-list.ts         ← builds out/send-queue.csv
├── types.ts
├── lib/
│   ├── http.ts            ← robots.txt, throttling, backoff
│   └── extract.ts         ← emails, names, year of call, opt-out notices
└── out/                   ← generated; gitignored
```

## Run order

```bash
# 1. Sanity check on two sets, no profile fetching
npx tsx scripts/outreach/scrape-chambers.ts --only=eleven-wentworth,banco --dry-run

# 2. One set end to end, capped
npx tsx scripts/outreach/scrape-chambers.ts --only=eleven-wentworth --max-profiles=5

# 3. A region
npx tsx scripts/outreach/scrape-chambers.ts --region=newcastle

# 4. Everything (hours, not minutes — leave it running)
npx tsx scripts/outreach/scrape-chambers.ts

# 5. Verify, score and order
npx tsx scripts/outreach/verify-list.ts
```

Outputs land in `scripts/outreach/out/`:

| File | What it is |
|---|---|
| `contacts.csv` | everything found |
| `excluded.csv` | what was excluded and why — the audit trail |
| `crawl-report.json` | per-set stats, errors, robots decisions |
| `send-queue.csv` | **the working file** — verified, scored, ordered |
| `dropped.csv` | removed at the verify stage, with reasons |
| `suppression.csv` | unsubscribes. Never emailed again. |
| `sent-log.csv` | append a row every send |

Add `scripts/outreach/out/` to `.gitignore`. It contains other people's
personal information and does not belong in a git history.

---

## Why the list is built this way

### The NSW Bar Association directory is not usable

The obvious source is `find-a-barrister.nswbar.asn.au`. Its terms:

> "Any use of this website other than for personal research is strictly forbidden."
>
> "The use of website scraping, data harvesting, or search spidering for any
> purpose other than to supply search query results to end-users is strictly
> forbidden."
>
> — <https://nswbar.asn.au/disclaimers/find-a-barrister>

That is the peak body for the exact people you are selling to. Beyond the
breach itself, it also destroys the inferred-consent argument in the next
section: consent can only be inferred where it is *"reasonable to assume that
the publication occurred with the agreement of"* the individual, and the
publisher has expressly said the data is not for this.

Nothing in `chambers-registry.ts` comes from that site. Chambers were
discovered by general web search and the NSW Barristers' Clerks Association
public member roll.

### The Law Society of NSW register is also out — and this one is worse

This closes the solicitor half of the plan, so it's worth stating plainly. The
Law Society's Terms of Use prohibit **two separate things**:

> "undertake data harvesting of personal information from the Law Society website"
>
> "use information obtained from the Law Society website about a person,
> corporation or other entity to send unsolicited communications to that person,
> corporation or other entity"
>
> — <https://www.lawsociety.com.au/terms/index.htm>

And the register page adds: *"Commercial use of this information is prohibited."*

The second clause bans the **use case**, not the collection method. Copying
twenty solicitors' details out by hand and then emailing them still breaches
it. There is no manual workaround.

This matters because the Register of Solicitors is the only source that
publishes NSW solicitor emails at scale. The government registers don't carry
email at all — ABN Lookup publishes only *"State and postcode of main business
location"*, and ASIC gives a registered office address.

**So the solicitor route is firm websites, one at a time.** A sole
practitioner's own site publishes their address with their evident agreement
and isn't governed by anyone else's terms. It's slower and it doesn't
scale into a single crawl, which is exactly why barristers-first is the right
sequencing regardless.

### The legal basis for the emails themselves

[Spam Act 2003 (Cth) Sch 2 cl 4(2)](http://classic.austlii.edu.au/au/legis/cth/consol_act/sa200366/sch2.html)
permits inferring consent where **all** of these hold:

| Limb | Requirement | How this pipeline satisfies it |
|---|---|---|
| (a) | Address reaches a particular self-employed individual or office-holder | Barristers are sole practitioners. Role addresses (`info@`, `clerk@`) are separated out by `isRoleAddress` / `isClerkAddress`. |
| (b) | Address "conspicuously published" | Published on the barrister's own chambers site. `sourceUrl` records exactly where. |
| (c) | Reasonable to assume published with their agreement | Their own set's site, on their own profile page. |
| (d) | Publication **not** accompanied by a no-unsolicited-messages statement | `detectOptOutNotice()` scans every source page and excludes any address found alongside such a notice. |
| (e) | Message relevant to their "work-related business, functions or duties" | A NSW/HCA legal research tool, to a NSW barrister. |

Limb (d) is the one nobody implements, and it is a hard statutory off-switch
rather than a factor to weigh. `detectOptOutNotice()` is in
`lib/extract.ts`; excluded rows land in `excluded.csv` with the matched
sentence so you can review the call.

Then [s 17](http://classic.austlii.edu.au/au/legis/cth/consol_act/sa200366/s17.html)
(sender identification, valid 30 days),
[s 18](http://classic.austlii.edu.au/au/legis/cth/consol_act/sa200366/s18.html)
(clear unsubscribe), and Sch 2 cl 6 (honour within 5 business days) apply to
every message. The footer in `EMAIL-SETUP.md` covers all three.

**Privacy:** under the
[$3m small-business threshold](https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/organisations/small-business)
you are not an APP entity, so APP 3 and APP 5 don't bind you. The emails carry
a collection notice anyway — it's one sentence, this audience notices it, and
it makes crossing the threshold later a non-event. Note the exemption falls
away if you ever *trade* in personal information, which buying a list plausibly
is. Another reason not to.

### Crawl etiquette

- `robots.txt` is fetched and obeyed per origin. Disallowed → that set is
  skipped and recorded in `crawl-report.json`. No exceptions.
- ~2.5s between requests to the same host, jittered. Longer for hosts that have
  asked (`hbhiggins.com.au` returns 429s under any load).
- Honest User-Agent with a contact address.
- Backoff on 429/503, respecting `Retry-After`.
- Full run is a few hours. **Do not lower the delays.** These are small
  WordPress sites belonging to the people you want as customers.

---

## Two data traps already encoded

- **Edmund Barton Chambers** — `ebc44.com` is Sydney, `edmundbartonchambers.com.au`
  is **Adelaide**. Different sets, same name.
- **Coram Chambers** — `coramchambers.com.au` (Sydney) vs `coramchambers.co.uk`
  (a well-known UK family set).

Both would poison a name-matched list.

## Coverage

~70 crawlable sets in the registry: 58 Sydney CBD, 4 Parramatta, 6 Newcastle,
2–3 Wollongong, and Lismore / Orange / Gosford. Roughly 1,800–2,200 barristers
before corpus-fit filtering.

Two sets are in the registry but flagged `skip` with a reason
(`8-garfield-barwick` has no per-barrister URLs; `13-st-james` has no browsable
index) — manual only. A further ten chambers have no website at all and are
listed in `NO_WEBSITE_CHAMBERS`, reachable by phone through their clerk.

**North Sydney and Chatswood have no barristers' chambers** — the NSW Bar is
far more CBD-concentrated than it looks. Hunter Street Chambers' Wagga, Albury,
Dubbo and Tamworth pages are SEO landing pages for Newcastle barristers taking
circuit work, not physical chambers; they are deliberately not in the registry.

## The filter that matters most

`verify-list.ts` drops poor corpus fits before they reach the queue.

The corpus is NSWSC / NSWCA / NSWCCA / HCA / Cth Acts / NSW Acts. A family law
barrister practises in the Federal Circuit and Family Court — not in the
corpus. Migration is Federal Court and AAT. Workers compensation is the
Personal Injury Commission. Planning is the NSWLEC.

Emailing those practitioners is worse than not emailing them: it spends a
contact **and** produces a demo that comes back empty, in a profession of
~6,000 people who all know each other. The categories are in `POOR_FIT` in
`verify-list.ts` — revisit them as the corpus expands, not before.
