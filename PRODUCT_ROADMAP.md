# BriefBridge — Product Strategy & Roadmap (on the record)

> Written 13 July 2026. Purpose: comprehensive reference for product,
> pricing, go-to-market, and the technical implementation path for each
> planned feature — so decisions made in research sessions aren't lost.
> Status markers: ✅ built · 🔧 in progress · 📋 planned · 💭 idea

---

## 1. Current state (ACCURATE as of 13 Jul 2026 — supersedes any older "29%" figures)

**Corpus (all embedded with voyage-law-2, 1024-dim, pgvector HNSW):**
- ~57,000 NSW judgments: NSWSC 1999–2026, NSWCA ~1999–2026, NSWCCA ~1994–2026
- 1,611 High Court of Australia judgments 1998–2026 (via AustLII, custom parser)
- 1,259 Commonwealth Acts (100% of in-force principal Acts) — all content sections embedded
- 756/760 NSW public Acts — all content sections embedded
- ~3M+ judgment paragraph vectors, 166k+ legislation section vectors

**Product (built):**
- ✅ Semantic search (caselaw + legislation, parallel, voyage-law-2)
- ✅ Court-hierarchy re-ranking (HCA ×1.12, NSW CA/CCA ×1.06, SC ×1.0; 3× candidate
  pool re-rank; raw similarity preserved for display)
- ✅ Streaming chat with [N] citation verification, statute-first prompt rules,
  hierarchy-aware citation ordering
- ✅ Matters, files, multi-firm collaboration, invites (Resend-branded emails)
- ✅ Google OAuth branded to briefbridge.ai (custom auth domain)
- ✅ All Supabase auth emails branded + delivered via Resend
- ✅ Usage analytics: analytics_events table, chat_query/search_empty tracking,
  founder dashboard at /admin/analytics (gated to osr9915@gmail.com)
- ✅ Anti-hallucination behaviour verified: zero-retrieval produces framework-only
  answers with explicit "not cited" flags — never invented citations

**Verified output quality:** s 5O medical-negligence test query → 9/10.
Correct authorities (Dobler, Gould, MD), correct defence mechanics, hierarchy
ordering visibly working (CA hits outrank higher-raw-similarity SC hits).

**Known open items (technical):**
- 🔧 Legislation ranking: CLA s 5O embedded but scored below the 0.45 threshold
  for a query about it. Diagnostic script written (scripts/diag-legislation-ranking.ts)
  — run it, then fix = lower legislation threshold / boost statutes / enrich
  embedded_text. THIS IS THE TOP QUALITY ITEM.
- 📋 Pre-2008 HCA judgments have NULL decision_date (old-era coversheet format;
  parser tweak + re-check pass)
- 📋 ~49 failed HCA cases + ~600 failed old NSWSC cases (persistent parse
  failures on odd pages; autopsy with dump scripts when worth it)
- 📋 HCA archive 1903–1997 (same command, anchor fallback handles old template)
- 📋 Downgrade Supabase compute Medium → Micro once final embed run completes
- 📋 Privacy + Terms pages (fast; required for trust page AND Google logo verification)
- 📋 Vercel env: add RESEND_API_KEY + NEXT_PUBLIC_APP_URL; never DIRECT_DATABASE_URL
- 📋 Rotate postgres + briefbridge_app passwords (both appeared in dev chats)

---

## 2. Positioning

**BriefBridge is the legal reasoning engine — not practice management.**
Not email/calendar/CRM/time-recording. Every feature must answer:
*"Does this help a lawyer produce better legal work?"*

**Core differentiators vs ChatGPT / Lexis+ AI / Westlaw:**
1. Verification-first: every proposition pinned to a real paragraph in a real
   judgment; honest failure modes (says "not retrieved", never invents)
2. Australian-first corpus depth (NSW + HCA now; expansion by demand)
3. Court-hierarchy-aware retrieval and answer structure
4. Price: impulse-purchase vs $5–15k/yr incumbents

**The trust story (page to build):** citation verification · Australian data
residency · no training on user queries · client confidentiality handling.
Lawyers ask these three questions before anything else.

---

## 3. Feature roadmap (value ladder)

### Tier 1 — the $199/mo "Professional" features
Ordered by (differentiation × build-leverage on existing corpus):

**3.1 Citation Checker — THE signature feature** 📋
- Workflow: paste draft submissions → per-citation report:
  ✓ citation exists · ✓ pinpoint paragraph correct · ✓ quotation matches
  source text · ✓ authority still good law · ⚠ flags for each failure
- Why: professional risk reduction. Post fake-AI-citation scandals, partners
  understand this instantly. Fear-driven purchase, no behaviour change needed.
- Build notes: mostly existing assets —
  - citation strings → parse with existing citation regexes
  - existence: lookup judgments.citation (+ fuzzy on case_name)
  - pinpoint: paragraphs JSONB has per-paragraph numbers → fetch para N
  - quotation match: string-similarity between quoted text and paragraph text
  - "still good law" (v1): via Citator (3.2) — cases citing it since, flag if a
    later higher court discusses it (full treatment analysis is v2)

**3.2 Citator ("cited by") — the accidental CaseBase** 📋
- judgments.casesCited (JSONB, extracted at ingest) already contains the
  citation graph. Invert it: for case X, list every judgment citing X.
- Filters: court tier, date range, jurisdiction. Treatment classification
  (followed/distinguished/doubted/overruled) = v2 (LLM classification of the
  citing paragraph's language).
- Build notes: needs a citations join table for speed —
  `judgment_citations (citing_judgment_id, cited_citation text, cited_judgment_id nullable)`
  backfilled from casesCited JSONB; index on cited_citation. Resolve
  cited_judgment_id where the cited case is in-corpus.

**3.3 Research Memo Export (Word)** 📋
- Chat session → formatted .docx: Question Presented / Legislation /
  Authorities table / Analysis / Conclusion, AGLC4-style citations.
- Lawyers deliver Word documents, not chats. Makes output supervisor-ready.
- Build notes: docx generation lib + template; content = conversation messages
  + stored citations (messages.citations JSONB already holds them).

**3.4 Proposition Verification** 💭 (ChatGPT suggestion — strong)
- User writes a proposition ("the plaintiff bears the burden under s 5O") →
  Supported (authority + pinpoint) / Unsupported (closest contrary found:
  "defendant bears the burden — Gould at [30]").
- Build notes: semantic search the proposition; LLM judges
  supported/contradicted/silent against top hits; return verdict + pinpoints.
  Essentially chat with a constrained output schema — cheap to prototype.

**3.5 "Why this authority?"** 💭 (ChatGPT suggestion)
- Per-citation explanation: "Dobler establishes s 5O operates as a defence…"
- The synthesis juniors struggle with. Largely a prompt/UX feature over
  existing retrieval — low build cost, high perceived intelligence.

### Tier 2 — matter-centric workflow 📋 (after Tier 1 demand-tested)
- Brief/bundle analysis: upload brief → cross-document Q&A, auto chronology,
  issue extraction (files + AI-access controls already exist)
- Skeleton submission drafting from a matter's research trail (DELAY —
  everyone does generation; it's expected, not differentiating)

### Tier 3 — later 💭
- Chronology builder from evidence · limitation/court-date awareness ·
  firm precedent bank · additional jurisdictions (VIC/QLD Supreme Courts,
  Federal Court) — each needs its own fetcher+parser (see HCA build pattern)

---

## 4. Pricing

| Tier | Price | Contents | Buyer |
|---|---|---|---|
| Research | $79–99/mo | Search + chat + matters + memo-lite | Sole practitioners, barristers, grads/students (discounted) |
| Professional | $199/mo | + Citation Checker, Citator, Proposition Verification, polished Memo Export | Barristers, small-firm lawyers — Every citation verified before it reaches court. |
| Enterprise/Firm | custom (per-seat) | + collaboration, precedent bank, admin, SSO, security review | Firms 5+ lawyers |

Rules of thumb: 14-day trial then paid (free-forever users teach nothing);
a barrister billing $500/hr breaks even on $199 in <30 min saved/month.

---

## 5. Go-to-market

**Phase 1 — 10 paying users (manual, now):**
1. Personal outreach to 30–50 NSW practitioners (friends-of-friends, alumni,
   LinkedIn 2nd-degree): "built an AI research tool over NSW + High Court
   caselaw with paragraph-level citations — month free for 15 min of feedback"
2. One chambers floor demo (email 3–4 Sydney clerks) — one yes = 5–15 trials
3. Trust page live before outreach (data residency, no-training, verification)
4. Charge after trial. Watch /admin/analytics: queries-per-user-per-week is
   THE retention metric; empty-retrieval rate is THE product-gap metric.

**Phase 2 — 100 users:** referrals from happy users (lawyers cluster: chambers
floors, firm teams) · CPD-accredited sessions ("AI legal research" — rooms of
qualified buyers) · LinkedIn content (real research comparisons) · free/cheap
student tier (tomorrow's juniors carry it into firms)

**Phase 3 — scale:** firm deals (one 15-seat sale > 15 individual sales) ·
SEO (long-tail legal queries, e.g. "s 5O peer professional opinion" — thin
competition, corpus can generate authoritative pages; compounds 6–12 months)

**Realism:** AU market ≈ 90k solicitors + 6k barristers. 100 × $99 = $10k MRR
is the first serious milestone; 1,000 users = top-tier AU legal tech, a 2–3yr
outcome. Quit-the-job threshold: ~6 months expenses saved + MRR ≥ personal
burn + 3 consecutive months of week-4 retention.

---

## 6. Principles (learned, keep)
- Validation before feature expansion. Build Tier 1 features when paying
  users rank them, not before.
- Verification-first is the brand. Never trade it for fluency.
- Every feature leverages the corpus moat (citations graph, paragraphs,
  parsers). If a feature doesn't touch the corpus, question it.
- Ship at 85%. A lawyer who finds a rough edge and tells you beats ten
  features polished in private.