# The outreach emails

Offer: **15 minutes of honest feedback in exchange for a free month.**

Four variants below. They are not A/B tests of the same email with a different
subject line — they're four different arguments, so that after 100 sends you
know *which argument works on barristers*, which is worth far more than knowing
which subject line got opened.

Run roughly 25 of each before drawing conclusions. Log the variant in
`out/sent-log.csv`.

---

## Rules that apply to all of them

**No tracking pixels. No link shorteners. No click tracking.** Every mainstream
legal-sector mail filter — Mimecast, Proofpoint, Barracuda — scores these, and
a 1×1 tracking image in a cold email to a barrister is both the thing that
lands you in quarantine and the thing that, if noticed, ends the conversation.
You will not know your open rate. You do not need it; replies are the metric.

**Plain text. No HTML, no logo, no signature image.** You are one person
writing to one person. Make the email look like that.

**No attachments.** Ever, in a first email.

**No Calendly link in email one.** Asking someone to book time with a stranger
before they know what you are is a bigger ask than it looks. Get the reply
first.

**Address them properly.** `Dear Ms Nguyen` / `Dear Mr Fletcher SC` for the
first email. The Bar is formal and the courtesy costs nothing; first names read
as presumptuous from someone they've never met. Switch to first names the
moment they do.

**Send Monday–Thursday, 12pm–3pm Sydney.** Mornings are court. Friday
afternoon is a graveyard.

**One follow-up. Ever.** Seven days later, three sentences. Then stop. The
third email is where founder outreach becomes spam, and this profession talks
to itself.

---

## Variant A — the verification argument

The one I'd bet on. Post-*Ayinde* and the string of Australian fake-citation
referrals, every barrister has a live, specific, professional-risk reason to
care. You are not selling research speed. You are selling not being the next
name in a judgment about AI citations.

> **Subject:** Citation checking, NSW judgments
>
> Dear Ms Nguyen,
>
> I've built a legal research tool over the NSW Supreme Court, Court of Appeal
> and CCA judgments — about 57,000 of them — plus the High Court back to 1998
> and the in-force Commonwealth and NSW Acts.
>
> The reason I'm writing to you rather than putting up an ad: the thing I've
> spent most of the build on is making it refuse to invent citations. Every
> proposition it gives you is pinned to a numbered paragraph in a real
> judgment, and when it can't find authority it says so instead of producing
> something plausible. I'd like to know whether that's actually reassuring to
> someone who'd be relying on it, or whether it just moves the checking
> problem somewhere else.
>
> Would you take 15 minutes to tell me where it falls over? I'll open a free
> month either way — I'm after the criticism, not the signup.
>
> Oakley

## Variant B — show the answer

The strongest variant, and the slowest. Before sending, run a real query in
their actual practice area and paste the real output. Four or five sentences of
genuine, checkable legal analysis with correct pinpoints is not something a
mass sender can produce, and a barrister will know that within about three
seconds.

Budget 10 minutes per email. Use it on the top 30 rows of the send queue.

> **Subject:** s 5O and the Dobler line — a test I ran
>
> Dear Mr Fletcher,
>
> I've been building a research tool over the NSW and High Court corpus and
> testing it on questions where the answer is easy to get subtly wrong. I ran
> one in your area this morning — who bears the onus under s 5O of the Civil
> Liability Act — and it came back with *Dobler v Halverson* at [59]–[61] and
> *Sydney South West AHS v MD*, ordered Court of Appeal before first instance,
> and correctly framed s 5O as a defence rather than a standard.
>
> [paste the actual output here — 4–6 lines, with the pinpoints]
>
> I'd like to know whether that's the answer you'd have wanted, or whether it's
> missing something a practitioner would immediately see. 15 minutes, and I'll
> open a free month regardless.
>
> Oakley
>
> (I'm the person who built it — happy to be told it's wrong.)

## Variant C — the cost argument

For regional sets and small chambers, where per-head Westlaw or Lexis licensing
is worst and often simply isn't held. Use for `region != sydney-cbd` and small
`approxCount` sets. Do not use on a large CBD floor with a firm-wide licence —
it argues against something they aren't paying for.

> **Subject:** NSW caselaw search — built for chambers your size
>
> Dear Ms Whitton,
>
> Most of the research tools pitched at the NSW Bar are priced for firms with a
> library budget. I've built one that isn't: semantic search across ~57,000 NSW
> Supreme Court, Court of Appeal and CCA judgments, the High Court from 1998,
> and the in-force NSW and Commonwealth Acts, with every answer tied to a
> specific paragraph you can open and check.
>
> It searches by legal concept rather than keyword, so "peer professional
> opinion defence" finds the s 5O line of authority without you knowing the
> phrase the judgment used.
>
> I'm looking for a handful of practitioners outside the Sydney CBD sets to
> tell me what's missing before I build anything else. 15 minutes of honest
> feedback, free month, no card.
>
> Oakley

## Variant D — the short one

Under 90 words. Worth running as a control precisely because it makes no
argument — if it converts as well as A, your longer emails are doing nothing
and you can send more of them.

> **Subject:** Built a NSW caselaw tool — worth 15 minutes?
>
> Dear Mr Osborne,
>
> I've built a research tool over the NSW Supreme Court, Court of Appeal, CCA
> and High Court judgments, with paragraph-level citations you can verify.
> There are no users yet — you'd be among the first.
>
> Could I have 15 minutes of criticism? Free month in exchange, no card, and
> I'll take a no without following up.
>
> Oakley

---

## The follow-up (once, day 7)

> **Subject:** *(reply to your own thread — do not change the subject)*
>
> Dear Ms Nguyen,
>
> Following up once and then I'll leave it. If the timing's wrong or it's not
> for you, a one-word reply is genuinely fine and I'll take you off the list.
>
> Oakley

---

## When they reply

**"Yes, send me a login."** Do not send a signup link. Create the account
yourself, send a direct login link, and — this is the part that converts — ask
what they're working on and run the first query for them. From the roadmap:
*queries-per-user-per-week is THE retention metric.* A lawyer who never runs a
second query is not a user. Get query one to happen while you're on the call.

**"What about confidentiality / where's my data?"** This is the most common
first question from this audience and you need one link that answers it
completely. The trust page in the roadmap — data residency, no training on user
queries, citation verification, client confidentiality — is not a nice-to-have
before outreach. Have it live before day one of the ramp.

**"How much is it?"** Say the number. `$79–99/mo` research tier,
`$199/mo` professional. Hedging on price reads as either embarrassment or a
plan to charge them what they'll bear, and both are worse than the number.

**"No thanks" / "remove me".** Add the address to `out/suppression.csv` the
same day, with the reason and date. `verify-list.ts` reads that file on every
run, so they can never re-enter the queue. Reply once, briefly: *"Understood —
removed. Thanks for the reply."* Nothing else. A gracious no is worth keeping;
the Bar is ~6,000 people who talk to each other.

**No reply at all.** That is the normal case. 1–3% reply rates mean 97+ of every
100 say nothing. It is not a signal about the product.

---

## What to actually learn from the first 100

Track these in `sent-log.csv`, not opens:

1. **Which variant got replies** — the argument that works, not the subject line.
2. **What they asked about before agreeing** — confidentiality, price, coverage.
   The most-repeated question becomes the next thing you build or write.
3. **Whether they ran a second query.** `/admin/analytics` already tracks
   `chat_query` events. One query is curiosity. Two is a product.
4. **What they searched for that returned nothing.** `search_empty` is your
   corpus roadmap, written by the exact people you're trying to sell to. If ten
   barristers search the Land and Environment Court, you know what to ingest
   next — and you know it from demand rather than a guess.
