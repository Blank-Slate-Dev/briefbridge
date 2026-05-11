# Style Matching — Feature Spec

**Status:** Parked. Pick up after auth + real files infrastructure lands.
**Owner:** Oakley
**Drafted:** May 2026

---

## The pitch

BriefBridge learns how a lawyer drafts and applies that style to every output, so drafts don't need to be rewritten before they're usable.

The headline isn't "AI that writes for you." It's "AI that drafts the way you already draft." That includes citation format, sentence structure, formality register, heading conventions, capitalisation habits, and the dozens of small drafting decisions that distinguish a lawyer's work product from generic prose.

This is a real differentiator. Every legal AI tool on the market produces competent but recognisably-AI output that lawyers then have to rewrite. The rewrite tax is the reason most lawyers abandon these tools after a month. Style matching attacks that tax directly.

---

## What "style" actually means here

Not personality. Not voice. The concrete drafting decisions that go into a lawyer's work:

- **Citation format** — `at [10]` vs `para 10` vs `[10]` vs `(at [10])`; pinpoint conventions; treatment of unreported cases.
- **Structure** — IRAC vs issue/principle/application vs straight prose; headings vs no headings; numbered paragraphs.
- **Formality register** — `It is submitted that` vs `we submit` vs `the better view is`; the level of hedging.
- **Capitalisation conventions** — `the Plaintiff` vs `the plaintiff`; `the Court` vs `the court`; party labelling consistency.
- **Connective phrases** — `It follows that` vs `Accordingly` vs `Therefore`; `In the premises` vs `For these reasons`.
- **Latin usage** — `inter alia`, `prima facie`, `obiter` used freely, or avoided in favour of English.
- **Sentence rhythm** — average length, variance, use of subordination vs short declarative sentences.
- **Voice** (grammatical) — active vs passive proportion in different contexts.
- **Heading style** — italicised, bold, none, numbered, hierarchical depth.
- **Spelling and punctuation** — em-dash vs semicolon, Oxford comma, AU vs UK conventions.

These are observable, extractable, and applicable. They're also exactly the things that make AI output read as AI output when they're wrong.

---

## Demo moment

Two passes of the same draft request, side by side:

1. **Default mode:** generic legal-AI prose. Hedge-y, mixed citation styles, inconsistent capitalisation.
2. **Style-matched mode:** drafted using the lawyer's style profile + retrieved examples from their past work. Reads like a junior associate trained on their drafting.

The visceral moment is when a lawyer recognises their own conventions in output the AI produced. Not "sounds like me as a person" — *"that's how I would have formatted that citation."*

---

## How it works — three approaches

### Approach 1: Style profile injection (ship this first)

**What:** On a one-time analysis pass, extract a structured drafting profile from a user's uploaded documents. Inject it into the system prompt for every generation.

**Cost:** One Claude call per user at onboarding (and on each new batch of uploads). Negligible per-generation cost.

**How:**

1. User uploads 5-10 representative documents — submissions, advices, letters, file notes.
2. A background job runs an analysis pass with Claude. Extract:
   - Citation format conventions across different source types
   - Capitalisation conventions for parties, courts, statutes
   - Heading style and structural conventions
   - Connective and transition phrases
   - Latin usage frequency
   - Sentence length distribution
   - Hedging vocabulary and frequency
   - Punctuation tics
   - AU spelling consistency
3. Store as JSON keyed to user_id.
4. On each generation, inject: *"Match this lawyer's drafting style. Their conventions: [JSON]. Three short authentic snippets from their work: [snippet1], [snippet2], [snippet3]."*

**Pros:**
- Cheap.
- Persistent (no retrieval needed at generation time).
- Composes with everything else in the prompt.

**Cons:**
- Abstract — descriptions of style don't fully capture style. The model is doing one level of interpretation.

### Approach 2: Few-shot retrieval (layer on top of #1)

**What:** At generation time, retrieve 2-3 of the user's past documents that are *topically similar* to what they're drafting. Include those verbatim as style references.

**Cost:** Reuses the existing embedding infrastructure. Adds 2k-5k tokens to each generation call.

**How:**

1. Every uploaded document is chunked and embedded (already happens for retrieval).
2. Tag chunks with metadata: `author=user_id`, `doctype=submission|advice|letter|file-note`, `matter_id`.
3. When the user asks for a draft of type X about topic Y:
   - Embed the draft request.
   - Retrieve top-K chunks where `author=this_user` AND `doctype=X`, ranked by semantic similarity to the topic.
   - Inject 2-3 of those as: *"Examples of how this lawyer drafts [doctype]. Match the drafting style, structure, and conventions closely:"*
4. Combine with the style profile from #1.

**Pros:**
- Much more accurate output — model has concrete reference, not abstract description.
- Topic-aware — drafting a costs submission pulls in their previous costs submissions.

**Cons:**
- Cold start problem — new users have no corpus to retrieve from.
- More expensive per call.

### Approach 3: Fine-tuning (skip for now)

Skip. Anthropic doesn't offer fine-tuning on Claude, and switching providers for one feature fragments the stack. Revisit only if Anthropic launches fine-tuning or if a power user has thousands of documents and #1 + #2 are demonstrably insufficient.

---

## Recommended v1: #1 + #2 combined

The style profile catches universal conventions across all the user's work. The few-shot retrieval catches doctype-specific and topic-specific phrasing. Together they cover the gap.

The cold-start problem is solved by gating: profile extraction requires N>=5 uploaded documents. Before then, BriefBridge writes in a sensible default AU-legal style and surfaces a banner: *"Upload 5+ past documents to enable style matching."*

---

## Build estimate

Once auth + real files are in place:

- **Schema additions:** `user_style_profiles` table (`user_id`, `profile_json`, `extracted_at`, `source_doc_ids[]`). Add `author_user_id` and `doctype` columns to existing chunks/embeddings tables.
- **Profile extraction job:** ~1 day. Background worker that runs when a user crosses the 5-doc threshold or uploads new batch.
- **Doctype classifier:** ~half day. Quick Claude pass per uploaded doc to label it. Could be heuristic-first (filename matching) with Claude as fallback.
- **Retrieval filter:** ~half day. Modify the existing retrieval pipeline to optionally filter by `author_user_id` and `doctype`.
- **Prompt injection:** ~half day. Update the generation system prompt template.
- **UI:** ~1 day. Settings page showing the extracted profile so users can see what the system has learned. Toggle for "style matching" on/off per generation. Banner for cold-start state.
- **Testing + tuning:** ~2 days. This is where the magic happens — the extraction prompt will need iteration.

**Total: ~1 week of focused work.**

---

## Risks and edge cases

### The correction dilemma

If a user has a habit that's arguably wrong (e.g. capitalises `the Plaintiff` against the relevant style guide), do we preserve it or fix it?

**Default:** preserve. The whole point is "draft like this lawyer." Add a settings toggle for "fix style inconsistencies" for users who want a more rigorous default.

### Mixing authors

Lawyers often share drafting credit — a senior reviews a junior's work; a barrister revises a solicitor's brief. The "author" of a document isn't always the user who uploaded it.

**Fix:**
- Ask at upload: "Did you draft this, or are you uploading it for reference?"
- Default to "user drafted it" but allow tagging documents as "reference only — don't use for style matching."
- Long-term: pull style signals only from documents the user has flagged as their own work.

### Stale profile

A lawyer's drafting evolves. A profile extracted from 2020 work won't match how they draft in 2027.

**Fix:** Re-extract the profile periodically (every 90 days) or when a user uploads N new documents. Show the user when the profile was last updated.

### Multi-doctype drafting

A lawyer drafts formal submissions one way and plain-English client letters another. A single global profile averages them and matches neither well.

**Fix:** Profile per `doctype`, not just per user. Already implicit in the few-shot retrieval (filtered by doctype). Make it explicit in the profile too — extract separate profiles per doctype.

### Firm vs lawyer style

In larger firms, drafting style is partly the firm's house style, partly the individual lawyer's. Some firms want consistency across all output; others let lawyers retain individual style.

**Fix:** Support both — a firm-level house style profile (opt-in) that blends with the individual profile, with a setting for which takes precedence.

### Privacy

Style profiles describe drafting conventions, which feels less sensitive than the underlying documents — but they're still derived from privileged work product.

- Never share across users without explicit consent.
- "Firm house style" blending is opt-in, not default.
- Profile data must be deletable on request, separately from the underlying documents.

---

## Selling angle

Three lines:

> Lawyers waste hours rewriting AI-generated drafts because they don't match how the lawyer actually drafts. BriefBridge learns your citation conventions, your structural habits, your phrasing — from your past work — and applies them to every output. The result reads like a draft you'd send out, not a draft you'd start over.

This reinforces a defensive moat: the longer a lawyer uses BriefBridge, the more it has learned their style, the higher the switching cost.

---

## Dependencies (must land before this)

1. Auth (Supabase Auth) — to scope profiles per user.
2. Real matters + files tables — to have a corpus to draw from.
3. File upload + storage — actual documents in the system.
4. Per-user embeddings with author/doctype metadata — extension of current embedding pipeline.

Until those are in place, this is parked.

---

## Pre-work that can happen now

Even before auth lands:

1. **Draft and test the profile-extraction prompt.** Take 3-5 writing samples (your own, or borrowed anonymised samples from a lawyer friend). Run them through Claude with a draft extraction prompt. Iterate until the output captures distinctive drafting features. This is the trickiest part of the build and de-risks the rest of the work.
2. **Collect sample documents.** Ask 2-3 lawyer contacts if they'd share 5-10 anonymised past submissions for testing. This becomes the eval set for tuning later.
3. **Decide on profile schema.** Sketch the JSON structure. Run it past a lawyer — would they find the extracted profile useful to *read*? If yes, that's a UI page (settings → "your drafting style") and a trust-builder.

---

## Open questions to revisit

- Per-matter vs per-user profile? Lawyers may draft differently for different clients. Probably per-user with optional per-matter override.
- Style matching as a paid-tier feature? Free tier = neutral AU-legal default; paid tier = matched to your drafting. Probably yes — clear value-add.
- Non-English drafting? Out of scope for v1. Park.
