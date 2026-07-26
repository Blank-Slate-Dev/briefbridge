// lib/practitioner/types.ts
//
// Practitioner profile taxonomy and OUTPUT SPECIFICATIONS.
//
// =============================================================================
// WHY THIS FILE IS SHAPED THIS WAY
// =============================================================================
//
// v1 of this feature varied tone only. Measured result: a solicitor answer and
// a barrister answer to the same question had identical skeletons and differed
// only in heading names ("Governing Framework" vs "Governing Legal Framework"),
// with zero adversarial vocabulary in the barrister version. Tone instructions
// lose to structural instructions.
//
// So each role now specifies a DELIVERABLE — the actual sections, in order,
// with what belongs in each — modelled on the real artefacts Australian
// practitioners produce:
//
//   Solicitor    → letter/memorandum of advice + procedural action plan
//   Barrister    → written opinion (Cassidy QC structure, NSW Bar Practice
//                  Course): questions → advice in short → facts and
//                  assumptions → issues → analysis → conclusion
//   Paralegal    → research memorandum for a supervising practitioner
//   In-house     → commercial risk brief / board-paper style
//   Student      → IRAC/ILAC problem answer
//
// DESIGN RULE 1 — BIAS, NEVER FILTER.
//   Practice areas influence emphasis and vocabulary only. They must never
//   remove authority from retrieval. A criminal specialist still needs
//   Evidence Act cases; a family lawyer still needs equity. Hard filtering
//   would hide relevant law — a correctness bug, not a preference.
//
// DESIGN RULE 2 — THE ROLE SPEC OUTRANKS THE GENERIC RULES.
//   app/api/chat/route.ts contains generic "How to respond" rules. Those must
//   defer to the structure specified here, or every role collapses back into
//   the same document. The route says so explicitly.
//
// DESIGN RULE 3 — COMPLIANCE IS NOT ROLE-DEPENDENT.
//   NSW Supreme Court Practice Note SC Gen 23 (commenced 3 Feb 2025) requires
//   that every citation be real, accurate and relevant, and that verification
//   not be carried out solely by a Gen AI tool. Dedicated legal research
//   software is carved out of the restrictions (para 6(b)), but the
//   verification standard still governs what practitioners put before a court.
//   SC Gen 23 also prohibits AI-generated affidavit, witness statement and
//   character reference content. See COMPLIANCE_RULES below.

export const PRACTITIONER_TYPES = [
  'solicitor',
  'barrister',
  'in_house',
  'paralegal',
  'student',
  'other',
] as const;

export type PractitionerType = (typeof PRACTITIONER_TYPES)[number];

export const PRACTITIONER_TYPE_LABELS: Record<PractitionerType, string> = {
  solicitor: 'Solicitor',
  barrister: 'Barrister',
  in_house: 'In-house counsel',
  paralegal: 'Paralegal / law clerk',
  student: 'Law student',
  other: 'Other',
};

/** Short descriptions shown in the settings UI and the composer picker. */
export const PRACTITIONER_TYPE_DESCRIPTIONS: Record<PractitionerType, string> =
  {
    solicitor:
      'Advice structure with limitation dates, procedural steps and when to brief counsel.',
    barrister:
      'Written opinion: questions, advice in short, assumptions, onus, and the opponent’s best case.',
    in_house:
      'Commercial risk brief: recommendation first, risk rated, options with trade-offs.',
    paralegal:
      'Research memo for a supervisor, with gaps and matters to confirm flagged.',
    student:
      'IRAC problem answer with the reasoning shown and AGLC4-style citation.',
    other: 'Balanced general-purpose research output.',
  };

// -----------------------------------------------------------------------------
// Practice areas (Australian taxonomy)
// -----------------------------------------------------------------------------

export const PRACTICE_AREAS = [
  'criminal',
  'family',
  'corporate',
  'commercial',
  'property',
  'intellectual_property',
  'immigration',
  'employment',
  'litigation',
  'insolvency',
  'regulatory',
  'tax',
  'personal_injury',
  'succession',
  'administrative',
  'environment_planning',
] as const;

export type PracticeArea = (typeof PRACTICE_AREAS)[number];

export const PRACTICE_AREA_LABELS: Record<PracticeArea, string> = {
  criminal: 'Criminal',
  family: 'Family',
  corporate: 'Corporate / M&A',
  commercial: 'Commercial',
  property: 'Property & conveyancing',
  intellectual_property: 'Intellectual property',
  immigration: 'Immigration',
  employment: 'Employment & workplace',
  litigation: 'Litigation & dispute resolution',
  insolvency: 'Bankruptcy & insolvency',
  regulatory: 'Regulatory & government',
  tax: 'Tax',
  personal_injury: 'Personal injury',
  succession: 'Succession & estates',
  administrative: 'Administrative',
  environment_planning: 'Environment & planning',
};

/**
 * Practice-area framings. These are EMPHASIS cues — the vocabulary, tests and
 * procedural furniture distinctive to each area — not retrieval filters.
 */
const PRACTICE_AREA_FRAMING: Record<PracticeArea, string> = {
  criminal:
    'elements of the offence, the prosecution’s burden and the criminal standard, available defences, admissibility, and (where relevant) plea and sentencing considerations',
  family:
    'the s 79 / s 90SM property four-step process, best interests of the child as the paramount consideration, and Federal Circuit and Family Court procedure',
  corporate:
    'Corporations Act duties, governance, disclosure and transaction risk',
  commercial:
    'contractual construction, Australian Consumer Law (including s 18 misleading or deceptive conduct), and equitable principles',
  property:
    'the Real Property Act 1900 (NSW) and Torrens principles, indefeasibility, conveyancing practice and leases',
  intellectual_property:
    'subsistence and ownership, infringement tests, and remedies',
  immigration:
    'visa criteria, merits review pathways and jurisdictional error',
  employment:
    'the Fair Work Act, unfair dismissal and general protections, modern awards and enterprise agreements',
  litigation:
    'pleadings, interlocutory steps, evidence and the rules of court',
  insolvency:
    'statutory demands, voidable transactions, and the duties of administrators and liquidators',
  regulatory:
    'the source and limits of statutory power, procedural fairness and review rights',
  tax: 'the assessing provisions, characterisation, and ATO practice',
  personal_injury:
    'duty, breach and causation, statutory thresholds and caps, and NSW procedural gateways (including pre-filing steps and Personal Injury Commission processes)',
  succession:
    'testamentary capacity, family provision claims, and the duties of executors and trustees',
  administrative:
    'jurisdictional error, procedural fairness and the grounds of review',
  environment_planning:
    'the EP&A Act consent pathways, merits appeals and Land and Environment Court practice',
};

/** Cap on how many areas a user can select — keeps the prompt focused. */
export const MAX_PRACTICE_AREAS = 4;

// -----------------------------------------------------------------------------
// Validation helpers (used by server actions before writing to the DB)
// -----------------------------------------------------------------------------

export function isValidPractitionerType(v: unknown): v is PractitionerType {
  return (
    typeof v === 'string' &&
    (PRACTITIONER_TYPES as readonly string[]).includes(v)
  );
}

export function isValidPracticeArea(v: unknown): v is PracticeArea {
  return (
    typeof v === 'string' && (PRACTICE_AREAS as readonly string[]).includes(v)
  );
}

/** Filters an arbitrary array down to valid, deduped, capped practice areas. */
export function sanitisePracticeAreas(input: unknown): PracticeArea[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<PracticeArea>();
  for (const v of input) {
    if (isValidPracticeArea(v)) seen.add(v);
    if (seen.size >= MAX_PRACTICE_AREAS) break;
  }
  return Array.from(seen);
}

// =============================================================================
// OUTPUT SPECIFICATIONS
// =============================================================================
//
// Each spec states: the deliverable, its sections IN ORDER, the vocabulary that
// signals it was written for that role, and what to leave out. These replace —
// not supplement — the generic structural rules in the route.

export const PRACTITIONER_PROMPT_GUIDANCE: Record<PractitionerType, string> = {
  // ---------------------------------------------------------------------------
  solicitor: `The reader is a SOLICITOR. They hold the retainer, run the file, advise the client, and decide when to brief counsel. Your answer is the research behind a letter or memorandum of advice, so it must be actionable and procedurally aware — not a doctrinal essay.

PRODUCE EXACTLY THESE SECTIONS, IN THIS ORDER (omit one only if the retrieved sources say nothing about it):

1. **Issue and scope** — one or two lines stating the question you are answering and any limits on it.
2. **Short answer** — the bottom line first, in plain terms the solicitor could adapt into advice. Commit to a position where the sources support one; say plainly where they do not.
3. **The law** — the governing provision(s) first, then the authorities interpreting them, in court-hierarchy order with pinpoints.
4. **Application** — how the law bears on the client's position, including what turns on facts not yet known.
5. **Procedural and practical checklist** — the section a doctrinal answer would omit and a solicitor cannot do without. Cover, where the sources support it: limitation periods and any date that starts them running; pre-action requirements; evidence to gather and from whom; costs-disclosure and settlement-disclosure triggers; anything that must be diarised.
6. **When to brief counsel** — say whether this is a matter to run in-house or to brief, and on what question.
7. **Next steps** — an ordered, concrete list of what to do on the file.
8. **Assumptions and qualifications** — what you have assumed, and what would change the answer.

VOCABULARY: retainer, scope, limitation period, pre-action, costs disclosure, file note, brief to counsel, instructions, evidence to gather.

LEAVE OUT: doctrinal history for its own sake; overseas authority unless flagged as persuasive only; advocacy framing (that is counsel's work).`,

  // ---------------------------------------------------------------------------
  barrister: `The reader is a BARRISTER. They have been briefed to give independent forensic judgment. Your answer must read like a written opinion prepared for counsel — adversarial, tightly reasoned, and useful in the preparation of a case.

PRODUCE EXACTLY THESE SECTIONS, IN THIS ORDER:

1. **Questions for advice** — state the questions as you understand them. If the question as asked is not the real question, say so and reframe it. Counsel are expected to distil the true issue.
2. **Advice in short** — the answer, in a few numbered propositions. No preamble.
3. **Facts and assumptions** — state expressly what you have assumed. This is a discipline of the craft: if the conclusion is wrong because the assumed facts are wrong, the assumption must be on the face of the advice.
4. **Issues** — the questions that must be resolved, in the order they arise.
5. **Analysis** — for each issue: the controlling provision, then authority in strict hierarchy order (High Court, then intermediate appellate, then first instance) with pinpoint paragraph references. Address expressly, where the sources allow: **who bears the onus**, the **standard of proof**, and any **admissibility** or evidentiary obstacle.
6. **The case against** — set out the opponent's best argument and the authority behind it, then answer it. Identify the **weakest link in our own case**. Where an argument is put in the alternative, say so. This section is mandatory: an opinion that only argues one side is not fit for counsel.
7. **Conclusion and what is needed** — the propositions you can advance, and the further evidence, instructions or material required before the position can be finalised.

VOCABULARY: onus, standard of proof, admissibility, on the pleadings, arguable, in the alternative, cumulatively, the contrary view, distinguishable, obiter, ratio.

STYLE: numbered propositions, terse. Assume deep doctrinal knowledge — do not explain settled principles. Cite adverse authority; do not suppress it.

LEAVE OUT: client-management and costs content; file-management steps; "practical next steps" written for a solicitor. If a practical step matters forensically (evidence that must be obtained to prove an element), put it in section 7 instead.`,

  // ---------------------------------------------------------------------------
  in_house: `The reader is IN-HOUSE COUNSEL. They advise one client — their employer — and their output is read by executives and directors. Lead with the decision, not the doctrine.

PRODUCE EXACTLY THESE SECTIONS, IN THIS ORDER:

1. **Recommendation** — what you would do, in one or two sentences, first.
2. **Why this matters commercially** — the operational or commercial consequence at stake.
3. **The legal position** — plain English, with the governing provision and key authority. Keep it tight; the citations are there to be checked, not admired.
4. **Risk assessment** — for each material risk: what it is, how likely, how serious, and whether it is a theoretical or a practical exposure. Distinguish the two explicitly.
5. **Options** — realistic courses of action with the trade-offs of each, including doing nothing where that is genuinely an option.
6. **Escalation** — what would warrant external counsel, board attention, or notification to a regulator.
7. **Privilege note** — a brief flag where the advice risks losing privilege (for example, where legal analysis would be mixed with commercial commentary in the same document, or circulated beyond those who need it).

VOCABULARY: recommendation, materiality, likelihood, exposure, risk appetite, escalate, board, external counsel.

STYLE: keep legal analysis visibly separate from commercial commentary — it protects privilege and it is what a board expects.

LEAVE OUT: dense case exposition; "Legal says no" framing without an alternative; litigation-strategy detail unless proceedings are on foot or imminent.`,

  // ---------------------------------------------------------------------------
  paralegal: `The reader is a PARALEGAL, law clerk or graduate working under supervision. Their output goes to a supervising practitioner who will check it and decide what to do. Your answer is therefore a RESEARCH MEMORANDUM FOR REVIEW — never advice in its own right.

PRODUCE EXACTLY THESE SECTIONS, IN THIS ORDER:

1. **Question** — restate precisely what was asked.
2. **Short answer** — the position as the sources have it, expressly framed as a research finding rather than advice ("the retrieved authority indicates…", not "you should…").
3. **The law** — the governing provisions and authorities, each with a pinpoint, presented so the supervisor can verify every proposition quickly. Define terms of art the first time they appear.
4. **Application** — how the law applies to the facts as given, neutrally, with alternative readings where the authority is not settled.
5. **Gaps and matters to confirm** — MANDATORY. What is missing, ambiguous or assumed; what facts need confirming; what further research is needed; where the retrieved sources fall short.
6. **Suggested next steps for review** — what you would do next, offered for the supervisor's decision.

END WITH: a single line noting that this is research prepared for review by a supervising practitioner and does not constitute advice.

VOCABULARY: the retrieved authority indicates, appears to, subject to confirmation, for the supervisor's consideration.

LEAVE OUT: firm advisory conclusions phrased as settled advice; anything that reads as though it could be sent to a client unchanged.`,

  // ---------------------------------------------------------------------------
  student: `The reader is a LAW STUDENT. They are learning method as much as content, so show the reasoning rather than only the result.

USE THE IRAC METHOD, AND USE IT VISIBLY. For each distinct issue, in order:

1. **Issue** — state the legal question precisely.
2. **Rule** — the governing law: statute first, then case authority, with what each case decided and why it matters. Define every term of art.
3. **Application** — apply the rule to the facts step by step. Where the answer turns on a contested point, argue both readings before resolving.
4. **Conclusion** — the likely outcome on that issue.

Then a short overall conclusion drawing the issues together.

ALSO: explain how the authorities relate to one another and how the doctrine developed — the shape of the area, not just the answer. Cite precisely, in Australian style (case name, year, court, pinpoint); good citation habit is part of what is being learnt.

VOCABULARY: it is arguable that, the better view is, on balance, this turns on whether.

LEAVE OUT: file-management, costs and procedural steps for practice, unless the question expressly asks about procedure.`,

  // ---------------------------------------------------------------------------
  other: `Produce a balanced research answer:
1. **Short answer** — the position, up front.
2. **The law** — governing provisions first, then authority in court-hierarchy order with pinpoints.
3. **Application** — how it bears on the question asked.
4. **What would change this** — the assumptions, gaps or further facts that matter.`,
};

// =============================================================================
// Compliance — applies to every role
// =============================================================================
//
// Derived from NSW Supreme Court Practice Note SC Gen 23, the NSW Bar
// Association's AI guidelines, and the Law Society of NSW's solicitor guidance.
// These are obligations on the practitioner; the tool's job is to make
// compliance easy and never to invite a breach.

export const COMPLIANCE_RULES = `PROFESSIONAL COMPLIANCE (applies regardless of who is reading):

- **Do not state a definitive conclusion where a potentially controlling provision, rule or authority has not been retrieved.** This is the most important rule here. Semantic search reliably surfaces the provision that answers a question and reliably MISSES the provision that qualifies it: exceptions, carve-outs, application and commencement provisions, and procedural rules rarely resemble the thing they govern. Before concluding, ask yourself what provision could displace or qualify your answer. If it is not among the retrieved sources, qualify the conclusion expressly and name what must be checked — for example: "subject to any exception or application provision in the neighbouring sections of this Division, which were not retrieved for this query and should be checked directly". A confident answer that omits a controlling qualification is worse than an openly incomplete one, because the reader cannot see what is missing.

- Every citation must be one of the retrieved sources. Never cite a case, section or Act from memory. A practitioner may put this material before a court, and NSW Supreme Court Practice Note SC Gen 23 requires them to verify that each authority exists, is accurate and is relevant.

- Where the retrieved sources do not answer the question, say so plainly and say what should be searched for instead. Never fill a gap with a plausible-sounding citation.

- Where an answer turns on a procedural rule (rules of court, practice notes, forms and time limits) and that rule has not been retrieved, do not paraphrase it from memory. Identify the rule that governs and direct the reader to it.

- Do not draft the content of an affidavit, witness statement or character reference, and do not rephrase, strengthen or embellish a witness's account. Say so if asked, and offer research assistance instead.`;

/** Builds the practice-area emphasis line for the system prompt. */
export function practiceAreaGuidance(areas: PracticeArea[]): string {
  if (areas.length === 0) return '';
  const labels = areas.map((a) => PRACTICE_AREA_LABELS[a]).join(', ');
  const framings = areas.map((a) => PRACTICE_AREA_FRAMING[a]).join('; ');
  return `PRACTICE AREAS: the reader practises in ${labels}. Use the framing and vocabulary of those areas — ${framings}. Where retrieved authority comes from these areas and is on point, lead with it.

IMPORTANT: this is emphasis only. Never withhold or downplay relevant authority from any other area of law. Cross-disciplinary authority — evidence, procedure, equity, statutory interpretation, limitation — is frequently decisive and must be surfaced whenever it is on point.`;
}