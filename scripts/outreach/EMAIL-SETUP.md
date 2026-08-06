# Sending setup — briefbridge.ai

Everything here is checked against the live DNS for `briefbridge.ai` and
`briefbridge.com.au` as at 6 August 2026. Both domains are on GoDaddy
nameservers (`ns51/ns52.domaincontrol.com`, `ns35/ns36.domaincontrol.com`), so
every change below is made in **GoDaddy → My Products → Domains → DNS**.

---

## Where you're starting from

| | `briefbridge.ai` | `briefbridge.com.au` |
|---|---|---|
| A record | `216.150.1.1` (Vercel) | `15.197.148.33`, `3.33.130.190` |
| MX | **none** | **none** |
| SPF | **none** | **none** at root (`send.` subdomain has one) |
| DKIM | **none** | `resend._domainkey` ✅ |
| DMARC | `p=quarantine`, GoDaddy default `rua` | `p=quarantine`, GoDaddy default `rua` |

Two things follow from that table.

**Your transactional email works, but nobody can reply to it.**
`lib/email/send-invite.ts` sends as `invites@briefbridge.com.au`. Resend's
DKIM is correctly published and `send.briefbridge.com.au` carries
`v=spf1 include:amazonses.com ~all` with the SES feedback MX, so with
`adkim=r`/`aspf=r` both align and DMARC passes. Delivery is fine. But
`briefbridge.com.au` has no MX, so when an invited lawyer hits reply — and on
an invite email, some will — it bounces. Fixed in step 5.

**Nothing can send as `briefbridge.ai` today.** No SPF, no DKIM, and
`p=quarantine` already in force. That is actually the safe failure mode: it
means no one has been spoofing you. It also means the setup below is greenfield.

---

## Step 1 — Google Workspace

Sign up at `workspace.google.com` with `briefbridge.ai`. Business Starter is
enough; you can add users later.

Create **`oakley@briefbridge.ai`** as the primary. Use your real first name.
`hello@`, `team@` and `founder@` all read as a company pretending to be bigger
than it is, which is the opposite of the signal you want — a barrister opening
a cold email is asking *is there a person behind this*, and your name in the
From field is the cheapest possible yes.

Google will ask you to verify domain ownership. There is already a
`google-site-verification=hK3GAjpheiWPrtJALvVXkY466LTR-0fidFRBc9k50f8` TXT
record on the domain — if the console offers that token, verification is
instant. If it offers a different one, add it alongside; multiple TXT records
are fine.

## Step 2 — MX

Add one record. Google consolidated to a single MX in 2023; the old five
`ASPMX` records still work but there's no reason to use them on a new domain.

| Type | Name | Value | Priority | TTL |
|---|---|---|---|---|
| MX | `@` | `smtp.google.com` | `1` | 1 hour |

Delete any other MX record on `briefbridge.ai` first. There are none today, so
this should be a clean add.

## Step 3 — SPF

| Type | Name | Value | TTL |
|---|---|---|---|
| TXT | `@` | `v=spf1 include:_spf.google.com ~all` | 1 hour |

Two rules that break more setups than anything else:

- **One SPF record per domain.** Not two. If you later add Resend for
  transactional mail on this domain, you merge them into a single record:
  `v=spf1 include:_spf.google.com include:amazonses.com ~all`
- Leave the existing `google-site-verification` TXT alone. It's a separate
  record and they coexist.

Use `~all` (softfail), not `-all`, until you've watched DMARC reports for a
fortnight and know every legitimate sender.

## Step 4 — DKIM

DKIM is generated inside Google, not invented by you.

**Admin console → Apps → Google Workspace → Gmail → Authenticate email**.
Choose **2048-bit** and prefix `google`. Google prints a long TXT value.

| Type | Name | Value | TTL |
|---|---|---|---|
| TXT | `google._domainkey` | *(the value Google gives you)* | 1 hour |

GoDaddy's TXT field sometimes chokes on the length. If it rejects the value,
paste it without the surrounding quotes — GoDaddy adds them.

Then go back to the console and click **Start authentication**. Don't skip
this; generating the key and publishing the record does nothing until you turn
it on. Allow up to an hour.

## Step 5 — Fix the reply path on `briefbridge.com.au`

Your invite emails currently have nowhere to receive a reply. Two options:

**Option A (recommended, no code change).** Add an MX record on
`briefbridge.com.au` pointing at Google, and add `briefbridge.com.au` as a
domain alias in Workspace so `invites@briefbridge.com.au` lands in your
`oakley@briefbridge.ai` inbox.

| Type | Name | Value | Priority |
|---|---|---|---|
| MX | `@` | `smtp.google.com` | `1` |

**Option B.** Move transactional sending to `briefbridge.ai` — verify it in
Resend, publish the `resend._domainkey.briefbridge.ai` TXT and the
`send.briefbridge.ai` SPF/MX pair Resend gives you, then change the `FROM`
constant in `lib/email/send-invite.ts` (line 10). Cleaner long-term, since
everything then lives on one domain. **Send me that file and the Supabase SMTP
settings before changing it** — I don't want to guess what else references
`briefbridge.com.au`.

Do Option A now either way. It takes one record and stops replies bouncing today.

## Step 6 — DMARC

Your current record on both domains is GoDaddy's default:

```
v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;
```

Two problems: the reports go to GoDaddy, not you, so you have never seen one;
and `p=quarantine` is in force *before* your new SPF and DKIM are proven. If
DKIM is misconfigured on day one, your first cold emails vanish into quarantine
silently — the single worst failure mode, because it looks exactly like being
ignored.

**Replace it with this for the first two weeks:**

| Type | Name | Value |
|---|---|---|
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@briefbridge.ai; adkim=r; aspf=r; fo=1;` |

`p=none` means "don't act, just report" — you get visibility without risk while
you confirm alignment.

Raw DMARC reports are XML attachments and unreadable by a human. Point `rua` at
a free aggregator instead of your own inbox — Postmark's DMARC digests
(`dmarc.postmarkapp.com`) and dmarcian's free tier both send a plain-English
weekly summary. Use whatever `rua` address they give you.

**Once you've had two weeks of clean reports** (100% SPF and DKIM alignment on
everything you actually sent), move to `p=quarantine`, and a month later to
`p=reject`. Do the same on `briefbridge.com.au`.

## Step 7 — Verify before you send anything

Send one email from `oakley@briefbridge.ai` to `check-auth@verifier.port25.com`.
It replies with a report. You want three lines:

```
SPF check:          pass
DKIM check:         pass
DMARC check:        pass
```

Anything other than `pass` on all three, stop and fix it. Also send one to a
personal Gmail and use **Show original** — `SPF: PASS`, `DKIM: PASS`,
`DMARC: PASS`.

---

## The ramp

A brand-new domain sending 30 emails on day one looks exactly like a domain
bought for spamming, because that is what spammers do. Google and Microsoft
both weight *rate of change* as heavily as volume.

| | Mon | Tue | Wed | Thu | Fri | Week total |
|---|---|---|---|---|---|---|
| Week 1 | 5 | 5 | 8 | 8 | 10 | 36 |
| Week 2 | 12 | 12 | 15 | 15 | 18 | 72 |
| Week 3 | 20 | 22 | 25 | 25 | 28 | 120 |
| Week 4 | 30 | 30 | 30 | 30 | 30 | 150 |
| Week 5+ | 30–40 | | | | | 150–200 |

Hold at 30/day unless the numbers below are clean. **40–50/day is a ceiling for
individually-written email, not a target** — past about 40 you cannot write
genuinely different messages, and the moment they become templated the
personalisation that makes this work is gone.

Send between 8am and 4pm Sydney time, on weekdays. Not 6am, not 9pm. Barristers
are in court in the morning — early afternoon lands best.

**Stop and diagnose if any of these move:**

| Metric | Healthy | Stop at |
|---|---|---|
| Hard bounce rate | < 1% | 2% |
| Spam complaints | ~0% | 0.1% (Google's own threshold is 0.3%) |
| Reply rate | 2–5% | below 1% after 100 sends means the message is wrong, not the infrastructure |

Cold email to lawyers realistically returns 1–3% replies. At 30/day, ~600/month,
that's 6–18 replies a month. That is the honest number to plan against.

---

## What must be in every email

Not style advice — [Spam Act 2003 (Cth) s 17 and s 18](http://classic.austlii.edu.au/au/legis/cth/consol_act/sa200366/s17.html).

**s 17 — sender identification.** The message must "clearly and accurately
identify the individual or organisation who authorised the sending", include
"accurate information about how the recipient can readily contact" you, and
that information must stay valid for **at least 30 days**.

**s 18 — unsubscribe.** A clear, conspicuous statement that the recipient can
reply to unsubscribe, at an address capable of receiving those messages for at
least 30 days.

**Sch 2 cl 6 — timing.** Withdrawal of consent takes effect "at the end of the
period of 5 business days". Just honour it immediately; there is no upside in
using the five days.

A footer that satisfies all three, without looking like marketing:

```
—
Oakley Ryan · BriefBridge
Sydney NSW · oakley@briefbridge.ai · briefbridge.ai

I found your address published on your chambers' website. If you'd rather
not hear from me, reply with "no thanks" and I'll remove you permanently.
```

That second paragraph is doing two jobs. It is the s 18 unsubscribe, and it is
a voluntary collection notice. You are almost certainly under the
[$3m small-business threshold](https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/organisations/small-business)
and so exempt from APP 3 and APP 5 — but telling a lawyer where you got their
address, unprompted, is precisely the kind of thing that audience notices and
respects. It costs one sentence.

**One caveat worth keeping in view:** the small-business exemption falls away
if you ever *trade* in personal information. Buying a list from a data broker
plausibly counts. Building your own from public sources does not. That is a
second, independent reason not to buy a list.
