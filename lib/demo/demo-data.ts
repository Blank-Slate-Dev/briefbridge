// lib/demo/demo-data.ts
//
// Canned demo answers for the public /demo page.
//
// WHY CANNED: the demo serves logged-out visitors arriving from search. Running
// live inference for anonymous traffic costs money and invites abuse. These are
// REAL BriefBridge outputs, generated once through the product and pasted here
// verbatim — not marketing copy written to flatter the tool. The page says so.
//
// SELECTION: four questions chosen for frequency in practice and for showing
// what keyword search does badly — statute and caselaw resolved together,
// procedural consequence, and role-shaped output. Two solicitor, two barrister,
// across four practice areas.
//
// REFRESHING: re-generate whenever retrieval or the prompt changes materially,
// so the demo never drifts from what the product actually produces. Ask the
// question in the app in the stated mode, then paste the answer and sources.

export interface DemoSource {
  kind: 'caselaw' | 'legislation';
  /** e.g. "Dobler v Halverson [2007] NSWCA 335" */
  label: string;
  /** e.g. "at [59]" */
  pinpoint?: string;
  /** Court or breadcrumb line shown underneath. */
  context?: string;
  /** The retrieved passage itself — what makes the citation verifiable. */
  snippet?: string;
  /** Raw cosine similarity, rendered as a match percentage. */
  similarity: number;
}

export interface DemoAnswer {
  id: string;
  question: string;
  /** Practitioner mode the answer was generated in. */
  mode: string;
  /** One line on what this example demonstrates. */
  showcases: string;
  /** Answer body, verbatim from the product. */
  answer: string;
  sources: DemoSource[];
}

export const DEMO_ANSWERS: DemoAnswer[] = [
  {
    id: 'setting-aside-default-judgment',
    question: "How do NSW courts approach setting aside a default judgment?",
    mode: 'Solicitor',
    showcases:
      "The discretionary test, the evidence required, and the procedural path \u2014 with every proposition pinned to a paragraph.",
    answer: `Setting Aside a Default Judgment in NSW
1. Short Answer
NSW courts have an unfettered statutory discretion to set aside a default judgment. That discretion is guided by three principal factors — bona fide defence, adequate explanation for default, and length of delay — but the ultimate question is always whether it is in the interests of justice to permit the defendant to defend on the merits.

2. The Law
Governing Rule

The jurisdiction is found in UCPR r 36.16(2)(a), which provides that the court may set aside or vary a judgment or order after it has been entered if "it is a default judgment (other than a default judgment given in open court)" [1]. Note that the full text of that rule was not retrieved for this query and should be verified directly, including any neighbouring provisions that may qualify it.

The Civil Procedure Act 2005 (NSW)

The application of the guiding principles must now be read subject to the *Civil Procedure Act 2005* (NSW), including s 57(1)(a) (the just determination of proceedings). For example, there may be circumstances where it would be contrary to the just determination of proceedings to require a defendant to file affidavit evidence demonstrating a bona fide defence; in such cases a court would be unlikely to reject the application solely on that ground [5]. The relevant CPA sections were not retrieved directly for this query and should be checked in full.

The Guiding Factors

The leading formulation comes from **McColl JA in *Dunwoodie v Teachers Mutual Bank Ltd* [2014] NSWCA 24 at [43]**, adopted consistently by the Court of Appeal and the Supreme Court:

The fundamental (but not the only) principles guiding a court asked to exercise the unfettered discretion UCPR 36.16(2)(a) confers, are whether the applicant has a bona fide ground of defence, an adequate explanation for the failure to defend and the length of any delay: *Adams v Kennick Trading (Int) Ltd* (1986) 4 NSWLR 503 at 506. [1]

Prejudice to the plaintiff is also a relevant consideration [3].

The Overriding Test

The three factors are not exhaustive. The ultimate question is stated in court-hierarchy order as follows:

Court of Appeal in *J & M McNamee Holdings Pty Ltd v Mungerie Vale Pty Ltd* [2019] NSWCA 283 at [49]: "Fundamentally, the question is whether it is in the interests of justice to allow the party seeking to set aside a default judgment to be permitted to defend the proceedings on the merits", citing *Dai v Zhu* [2013] NSWCA 412 at [83]. [2]
Court of Appeal in *Dunwoodie* at [43]: same formulation, tracing to *Reinehr Industrial Lease & Finance Pty Ltd v Jordan* (NSW CA, 4 June 1974, unrep). [1]
Supreme Court in *B & B Enterprise (Aust) Pty Ltd v Sur Holdings Pty Ltd* [2016] NSWSC 490 at [22]: confirms that the three-factor test and the interests-of-justice test operate together, also citing *Violi v Commonwealth Bank of Australia* [2015] NSWCA 152 at [76]. [10]
3. Application
The framework operates as follows in practice:

Jurisdiction is established as soon as the judgment is a default judgment not given in open court — the court then has discretion to set it aside under UCPR r 36.16(2)(a) [1].
Three factors are assessed — courts weigh them together rather than treating any one as a threshold bar [1][3][10]:
*Bona fide defence*: The applicant must demonstrate a genuine, arguable defence — not a merely plausible assertion. However, in light of the CPA, a court will not invariably reject an application solely because no supporting affidavit has been filed [5].
*Adequate explanation*: The reason for the failure to defend is examined; a complete absence of explanation weighs against the applicant [1][3].
*Length of delay*: The longer and less explicable the delay, the heavier the burden on the applicant [1][10].
Prejudice to the plaintiff is weighed against the defendant's case for relief [3].
The interests of justice is the lens through which all factors are synthesised — a technically weak showing on one factor may be overcome where allowing the matter to proceed to trial is the just outcome [2][10].
4. What Would Change This
Factor	What to check
Full UCPR rule	Verify r 36.16(2)(a) and surrounding sub-rules directly — the retrieved snippet does not show the full rule or any exceptions
CPA provisions	Sections 56–60 of the *Civil Procedure Act 2005* (NSW) (overarching case management obligations) were not retrieved and may qualify the discretion further — check them directly
Strength of the defence	A defendant who cannot articulate any arguable defence faces a high bar; the court will rarely reward a bare assertion [4]
Plaintiff's prejudice	Evidence that the plaintiff has irretrievably altered its position in reliance on the judgment would weigh heavily against setting aside [3]
Time elapsed since judgment	Very long delay (years) with no explanation has led to refusal even where a defence arguably exists — confirmed across the cases cited but highly fact-specific
Judgment given in open court	If the default judgment was given in open court, r 36.16(2)(a) does not apply on its face; a different pathway under r 36.16 or elsewhere would need to be identified [1]
*This is research assistance only, not legal advice. All citations should be verified against the official judgment and legislative text before reliance, consistent with the requirements of NSW Supreme Court Practice Note SC Gen 23.*`,
    sources: [
      {
        kind: 'caselaw',
        label: "Dunwoodie v Teachers Mutual Bank Ltd [2014] NSWCA 24",
        pinpoint: "at [43]",
        snippet: "Setting aside a default judgment The court's jurisdiction to set aside the default judgement is found in the bald terms of Uniform Civil Procedure Rules 2005 (NSW) (\"UCPR\") 36.16(2)(a), providing the \"court may set aside",
        similarity: 0.68,
      },
      {
        kind: 'caselaw',
        label: "J & M McNamee Holdings Pty Ltd v Mungerie Vale Pty Ltd trading as Greenwood Group Realtors [2019] NSWCA 283",
        pinpoint: "at [49]",
        snippet: "Principles \u2013 setting aside a default judgment Fundamentally, the question is whether it is in the interests of justice to allow the party seeking to set aside a default judgment to be permitted to defend the proceedings ",
        similarity: 0.67,
      },
      {
        kind: 'caselaw',
        label: "J & M McNamee Holdings Pty Ltd v Mungerie Vale Pty Ltd trading as Greenwood Group Realtors [2019] NSWCA 283",
        pinpoint: "at [48]",
        snippet: "Principles \u2013 setting aside a default judgment It is well established that the considerations relevant to an application to set aside a default judgment include whether the applicant has a bona fide ground of defence, an ",
        similarity: 0.67,
      },
      {
        kind: 'caselaw',
        label: "Balanced Securities Ltd v Oberlechner [2007] NSWSC 80",
        pinpoint: "at [24]",
        snippet: "No basis has been established for an order setting aside the default judgment.",
        similarity: 0.7,
      },
      {
        kind: 'caselaw',
        label: "J & M McNamee Holdings Pty Ltd v Mungerie Vale Pty Ltd trading as Greenwood Group Realtors [2019] NSWCA 283",
        pinpoint: "at [52]",
        snippet: "Principles \u2013 setting aside a default judgment It is also to be accepted that the application of these principles must now be subject to the provisions of the Civil Procedure Act 2005 (NSW). In Dai v Zhu, Sackville AJA ga",
        similarity: 0.66,
      },
      {
        kind: 'caselaw',
        label: "Youssef v Shepherd [2021] NSWSC 1355",
        pinpoint: "at [4]",
        snippet: "For the reasons that follow, I have concluded that the default judgment should be set aside.",
        similarity: 0.7,
      },
      {
        kind: 'caselaw',
        label: "Pan v Bo [2008] NSWSC 961",
        pinpoint: "at [40]",
        snippet: "Accordingly, I am satisfied that it is appropriate for me to exercise my discretion in favour of setting aside the default judgment.",
        similarity: 0.69,
      },
      {
        kind: 'caselaw',
        label: "HG INVESTMENT CAPITAL HOLDINGS PTY LTD v ORANGE GAMING PTY LTD [2025] NSWSC 1378",
        pinpoint: "at [14]",
        snippet: "The law \u2013 setting aside default judgments The relevant principles were set out in the decision of McColl JA in Dunwoodie v Teachers Mutual Bank Ltd [2014] NSWCA 24 at [43]-[46] (\u2018Dunwoodie\u2019):",
        similarity: 0.69,
      },
      {
        kind: 'caselaw',
        label: "Roach v Lawler [2005] NSWSC 288",
        pinpoint: "at [9]",
        snippet: "The authorities on setting aside default judgment are Evans v Bartlam (1937) AC 473 at 489; Vacuum Oil Pty Limited v Stockdale (1942) 42 SR (NSW) 239; Cuttle v Brandt (1947) 64 WN (NSW) 96 at 97; and Adams v Kennick Trad",
        similarity: 0.68,
      },
      {
        kind: 'caselaw',
        label: "B & B Enterprise (Aust) Pty Ltd v Sur Holdings Pty Ltd [2016] NSWSC 490",
        pinpoint: "at [22]",
        snippet: "True it is that the factors guiding the discretion of a court to set aside a default judgment are whether there was an adequate explanation for the failure to defend; the length of delay in doing so; and whether the appl",
        similarity: 0.68,
      },
    ],
  },
  {
    id: 'security-for-costs',
    question: "When will the court order security for costs against a corporate plaintiff?",
    mode: 'Barrister',
    showcases:
      "A forensic opinion: onus, the discretionary factors, and the opponent\u2019s best argument set out and answered.",
    answer: `Security for Costs Against a Corporate Plaintiff
Short Answer
A court will order security for costs against a corporate plaintiff when (1) it appears by credible testimony that there is reason to believe the corporation will be unable to pay the defendant's costs if the defendant is successful, and (2) the court exercises its discretion in favour of making the order. Satisfaction of the first condition is a precondition to the discretion arising; it does not compel an order.

The Law
Governing Provisions
Two statutory sources confer the power:

s 1335(1) of the Corporations Act 2001 (Cth) [11] provides that where a corporation is plaintiff in any action or other legal proceeding, the court may — if it appears by credible testimony that there is reason to believe the corporation will be unable to pay the defendant's costs if the defendant is successful — require sufficient security to be given and stay all proceedings until security is given.
UCPR r 42.21(1)(d) also confers power to order security where there is reason to believe a plaintiff corporation will be unable to pay the defendant's costs if ordered to do so. [2][4] This rule operates in parallel to s 1335(1) and is relevantly in the same terms. [8]
Note: s 1335(1A) expressly excludes Aboriginal and Torres Strait Islander corporations from the operation of s 1335(1) [11]; equivalent provision is made under s 581-20 of the *Corporations (Aboriginal and Torres Strait Islander) Act 2006* (Cth) [12]. No other exceptions or carve-outs were retrieved for this query — neighbouring sections and any applicable regulations should be checked directly.

The Two-Stage Structure
Courts have consistently construed s 1335(1) as involving a two-stage analysis:

Precondition — it must appear by credible testimony that there is reason to believe the corporation will be unable to meet an adverse costs order. [3][5][6]
Discretion — if the precondition is satisfied, the court has a discretion whether to order security. [3][9]
Key Principles from Authority (Court of Appeal first)
Principle	Source
The precondition requires "credible testimony" of a risk of inability to pay — not mere assertion	[3][8]
Once inability to pay is established, "serious consideration will be given" to ordering security	[1]
One rationale for the jurisdiction is to prevent those who will benefit from the litigation (shareholders, creditors, third parties) from using an impecunious corporate plaintiff as a shield against an adverse costs order	[7]
Once impecuniosity is established, the court considers whether security can be ordered without frustrating or stifling the plaintiff's claim	[9]
If security can be given without stifling the claim, it is "usually not difficult" to decide it is fair and just to make the order	[9]
Application
The framework operates as follows in practice:

Establish impecuniosity — the defendant must adduce credible testimony that creates reason to believe the corporate plaintiff cannot satisfy a costs order. This is a threshold, not a high bar, but bare assertion will not suffice. [3][8]
Discretion is then engaged — satisfaction of the threshold does not mandate an order. The court considers all relevant circumstances, including:
Whether an order would stifle or frustrate the plaintiff's claim [9]
Whether the persons who stand to benefit from the litigation are shielded from costs consequences by the corporate structure [7]
Whether a form of security is readily available to the plaintiff [9]
Practical consequence — proceedings may be stayed until security is provided. [11]
What Would Change This
The following facts or arguments are legally material and could affect the outcome:

Evidence of solvency — financial evidence demonstrating the plaintiff can pay would defeat the precondition entirely.
Stifling argument — if the plaintiff can show that an order for security would effectively bring the litigation to an end (stifle the claim), courts treat this as a significant discretionary factor against ordering security. [9] The weight of this factor depends on why the plaintiff cannot fund security.
Third-party support — if shareholders or related parties are willing to provide a costs undertaking or guarantee, this may be relevant both to the precondition (reduced risk of irrecoverable costs) and the discretion.
Nature of the claim — courts have noted that parties who benefit from a corporate plaintiff's success while sheltered from its costs exposure is a reason favouring security [7]; conversely, a plaintiff litigating genuinely for its own account may be treated differently (inferred — requires confirmation from authority not retrieved for this query).
Applicable rule — whether the application is brought under s 1335(1) or UCPR r 42.21(1)(d) may affect procedural requirements and available grounds; the full text of r 42.21 was not retrieved and should be consulted directly.
Exceptions and carve-outs — the provisions immediately surrounding s 1335 were not fully retrieved; any further exceptions (beyond the ATSI corporation carve-out in s 1335(1A)) should be verified in the Act directly.
*This is research assistance only, not legal advice. All citations should be verified against the official versions of the judgment and legislation before being relied upon or placed before a court, in accordance with NSW Supreme Court Practice Note SC Gen 23.*`,
    sources: [
      {
        kind: 'caselaw',
        label: "Circaz Pty Limited v Manolidis [2003] NSWSC 455",
        pinpoint: "at [10]",
        snippet: "This point of itself leads to the position that, as a general rule, if a corporation is shown to be not likely to be able to pay a defendant\u2019s costs if unsuccessful, then serious consideration will be given to requiring ",
        similarity: 0.77,
      },
      {
        kind: 'caselaw',
        label: "Black Hill Residents Group Inc v Marist Youth Care Ltd [2021] NSWCA 314",
        pinpoint: "at [13]",
        snippet: "Under r 42.21(1)(d) security for costs may be ordered if there is reason to believe that the plaintiff (appellant), being a corporation, will be unable to pay the costs of the defendant (respondent) if ordered to do so.",
        similarity: 0.73,
      },
      {
        kind: 'caselaw',
        label: "LSKF Holdings Pty Ltd v Shield Lifestone Holdings Pty Ltd [2018] NSWCA 109",
        pinpoint: "at [12]",
        snippet: "Consideration First, the section involves a precondition, namely, it appearing by credible testimony of a risk of a corporate plaintiff being unable to meet an adverse costs order, and a discretion if that precondition b",
        similarity: 0.72,
      },
      {
        kind: 'caselaw',
        label: "Wyse & Young International Pty Ltd t/as Wyse & Young Accounting & Ors v Corrado [2015] NSWSC 1863",
        pinpoint: "at [52]",
        snippet: "Under r 42.21(1)(d), security for costs can be ordered if \"there is reason to believe that a plaintiff, being a corporation, will be unable to pay the costs of the defendant if ordered to do so.\"",
        similarity: 0.76,
      },
      {
        kind: 'caselaw',
        label: "Vannella Pty Limited atf Capitalist Family Trust v TFM Epping Land Pty Ltd; Decon Australia Pty Limited v TFM Epping Land Pty Ltd; Vannella Pty Limited v TFM Epping Land Pty Ltd [2019] NSWSC 1379",
        pinpoint: "at [161]",
        snippet: "Legal principles Section 1335(1) of the Corporations Act provides that, where a corporation is a plaintiff in any legal proceeding, the Court may order the corporation to give security for costs if it appears that there ",
        similarity: 0.75,
      },
      {
        kind: 'caselaw',
        label: "Ant & Ballast Pty Ltd v City of Greater Geelong (No 2) [2019] NSWSC 753",
        pinpoint: "at [17]",
        snippet: "Legal principles Section 1335(1) of the Corporations Act provides that, where a corporation is a plaintiff in any legal proceeding, the Court may order the corporation to give security for costs if it appears there is re",
        similarity: 0.75,
      },
      {
        kind: 'caselaw',
        label: "Lawrence Waterhouse Pty Ltd v Port Stephens Council [2008] NSWCA 235",
        pinpoint: "at [32]",
        snippet: "It should be recalled, as the Court said in Idoport (at [39] \u2013 [40]), that one of the rationales for ordering security for costs in the case of corporations is to ensure that those who will benefit from success in the pr",
        similarity: 0.7,
      },
      {
        kind: 'caselaw',
        label: "Wollongong City Council v Legal Business Centre Pty Limited [2012] NSWCA 245",
        pinpoint: "at [27]",
        snippet: "Legal principles governing the making of an order for security for costs The Corporations Act 2001 (Cth), s 1335(1) is in relevantly the same terms: \"1335 Costs (1) Where a corporation is plaintiff in any action or other",
        similarity: 0.69,
      },
      {
        kind: 'caselaw',
        label: "Circaz Pty Limited v Manolidis [2003] NSWSC 455",
        pinpoint: "at [14]",
        snippet: "The result of these factors is that, once it is shown, in a case where the plaintiff is a corporation, that the corporation is unlikely to be able to pay the defendant\u2019s costs if unsuccessful, then consideration will be ",
        similarity: 0.73,
      },
      {
        kind: 'caselaw',
        label: "Laith & Fadi Investments Pty Ltd v Fogo Brazilia Holdings Pty Ltd [2024] NSWSC 1508",
        pinpoint: "at [153]",
        snippet: "ISSUE 1: WHETHER TO MAKE AN ORDER FOR SECURITY FOR COSTS Section 1335 of the Corporations Act 2001 (Cth) also confers a power to order security for costs in circumstances where a corporation is a plaintiff, relevantly pr",
        similarity: 0.73,
      },
      {
        kind: 'caselaw',
        label: "Statute\nCorporations Act 2001 (Cth) s 1335",
        snippet: "Costs Chapter 9 > Part 9.6 > s 1335 (1) Where a corporation is plaintiff in any action or other legal proceeding, the court having jurisdiction in the matter may, if it appears by credible testimony that there is reason ",
        similarity: 0.6,
      },
      {
        kind: 'caselaw',
        label: "Statute\nCorporations (Aboriginal and Torres Strait Islander) Act 2006 (Cth) s 581",
        snippet: "\u201120 Costs Chapter 14 > Part 2 > Division 581 > s 581 (1) If an Aboriginal and Torres Strait Islander corporation is plaintiff in any action or other legal proceeding, the court having jurisdiction in the matter may, if i",
        similarity: 0.56,
      },
    ],
  },
  {
    id: 'limitation-extension-personal-injury',
    question: "Can we get an extension of the limitation period for a personal injury claim?",
    mode: 'Solicitor',
    showcases:
      "Deadline-critical work: the statutory pathways, what must be proved, and what to diarise.",
    answer: `Extension of Limitation Period — Personal Injury Claim (NSW)
1. Short Answer
Yes, NSW law provides mechanisms to extend the primary 3-year limitation period for personal injury claims, subject to satisfying either a knowledge-based threshold (under s 58) or a "just and reasonable" discretionary test (under s 60C). The available pathway depends on when the cause of action accrued and the circumstances of the delay.

2. The Law
Primary Limitation Period
The primary limitation period for personal injury claims is 3 years. Extensions are governed by the *Limitation Act 1969* (NSW), Part 3, Division 3. [6][10]

Two Extension Pathways
Pathway A — Section 58 (knowledge-based extension): Section 58 applies to causes of action founded on negligence, nuisance or breach of duty for damages for personal injury (excluding surviving estate actions and *Compensation to Relatives Act* claims). [12]

The court may extend the limitation period where it appears that:

(a) any material fact of a decisive character was not within the applicant's means of knowledge until a date after the commencement of the year preceding expiry of the limitation period; and
(b) there is evidence to establish the cause of action apart from any limitation defence. [12]
If granted, the period is extended to expire one year after the date on which the material fact became knowable. [12]

Pathway B — Section 60C (just and reasonable extension): Section 60C applies to causes of action founded on negligence, nuisance or breach of duty for damages for personal injury (excluding *Compensation to Relatives Act* claims). [14]

"the court, after hearing such of the persons likely to be affected by the application as it sees fit, may, if it decides that it is just and reasonable to do so, order that the limitation period for the cause of action be extended for such period, not exceeding 5 years, as it determines." [14]

This is a discretionary jurisdiction, with a maximum extension of 5 years beyond the primary 3-year period. [6][9][14]

When Does Pathway B Apply?
Section 60A confines Subdivision 2 (which includes s 60C) to causes of action that accrued on or after 1 September 1990. [11]

Critically, s 60A also provides that Subdivision 2 does not apply to a cause of action to which Division 6 of Part 2 applies. [11][4] Where Division 6 of Part 2 applies, the s 60C procedure is unavailable. [4]

For causes of action that accrued before 1 September 1990, Schedule 5, cl 4 provides that ss 60G and 60H may apply instead, with applications required within 3 years commencing 1 September 1990 or the 3-year period under s 60I. [13]

Secondary Limitation Period
The s 60C extension is itself subject to a secondary limitation period: [7]

The applicant must not have known (or ought not to have known) that personal injury had been suffered, its nature or extent, or the connection between the injury and the defendant's act or omission; and
The application must be made within 3 years after the applicant became aware (or ought to have become aware) of those matters. [7]
*(Note: The secondary limitation period rules in s 60I were described in [7] but that section was not directly retrieved — the lawyer should verify the precise text of s 60I.)*

3. Application
Assuming a NSW personal injury claim:

If the cause of action accrued on or after 1 September 1990 and Division 6 of Part 2 does not apply, both s 58 and s 60C are potentially available.
s 60C is the more flexible pathway — the court has a broad discretion to extend up to 5 years if just and reasonable, without needing to establish that a decisive material fact was unknown. [14]
s 58 imposes a stricter threshold (a material fact of decisive character was outside means of knowledge) but is not capped at 5 years in the same way. [12]
The secondary limitation period means that even a successful applicant under s 60C must act within 3 years of acquiring the relevant awareness — delay beyond that point may foreclose the extension. [7]
4. What Would Change This
The following facts and provisions are critical and should be verified:

Factor	Why It Matters
Date the cause of action accrued	Determines whether s 60C (post-1 Sep 1990) or Schedule 5 (pre-1 Sep 1990) applies [11][13]
Whether Division 6 of Part 2 applies	If it does, s 60C is expressly excluded [11][4]; the retrieved sources do not include the text of Division 6 of Part 2 — this must be checked directly in the Act
When the plaintiff became aware of injury, its nature/extent, and causation	Governs the secondary limitation period under s 60I [7] — s 60I was not retrieved and must be verified
Nature of the claim	*Compensation to Relatives Act* claims are excluded from both s 58 and s 60C [12][14]
Whether the claim is a surviving estate action	Excluded from s 58 [12]
How far outside the primary period	The 5-year cap under s 60C means that claims very substantially out of time may be unextendable under that section [14]
12-year longstop	[10] refers to a 12-year stop period and a separate discretion to extend it — the governing provision was not retrieved and should be checked
Specifically, the text of Division 6 of Part 2 was not retrieved for this query. Whether it applies to your client's claim is potentially determinative, as it expressly excludes the s 60C procedure [11][4]. That Division must be examined directly in the *Limitation Act 1969* (NSW).

*This is research assistance only, not legal advice. All citations should be verified against the official version of the legislation and the judgment on NSW Caselaw before being relied upon or placed before a court.*`,
    sources: [
      {
        kind: 'caselaw',
        label: "Reznitsky v Rothonis [2021] NSWSC 281",
        pinpoint: "at [1]",
        snippet: "HER HONOUR: This is an application to extend the limitation period in relation to a personal injury claim.",
        similarity: 0.71,
      },
      {
        kind: 'caselaw',
        label: "Gorczyski v W & FT Osmo Pty Ltd [2022] NSWSC 1517",
        pinpoint: "at [50]",
        snippet: "CONSIDERATION The personal injury claim is not affected by any of the extensions in time provided for in bringing personal injury claims: see Limitation Act 1969 Part 2 Div. 6, Part 3 Div. 3.",
        similarity: 0.68,
      },
      {
        kind: 'caselaw',
        label: "Queensland v Stephenson [2006] HCA 20",
        pinpoint: "at [64]",
        snippet: "Section 11 of the Limitation of Actions Act 1974 (Q) (\"the Act \") provides that \"an action for damages for negligence ... in which damages claimed by the plaintiff consist of or include damages in respect of personal inj",
        similarity: 0.6,
      },
      {
        kind: 'caselaw',
        label: "Greenwood v Papademetri [2007] NSWCA 221",
        pinpoint: "at [46]",
        snippet: "There is provision in section 60A and following for the court to have a discretionary power to extend the three-year limitation period for personal injury cases. However, section 60A expressly provides that that procedur",
        similarity: 0.63,
      },
      {
        kind: 'caselaw',
        label: "Cranbrook School v Stanley [2002] NSWCA 290",
        pinpoint: "at [14]",
        snippet: "Section 60A provides: \u201cThe purpose of this Subdivision is to provide a procedure for a 5 year (maximum) extension of the 3 year limitation period for personal injury cases. It applies to causes of action that accrue on o",
        similarity: 0.62,
      },
      {
        kind: 'caselaw',
        label: "SCHERING-PLOUGH PTY LIMITED v PAGE [2002] NSWCA 4",
        pinpoint: "at [9]",
        snippet: "Part 3 of the Limitation Act concerns postponement of the bar imposed relevantly by s18A of three years from the accrual of the cause of action. Division 3 concerns personal injury cases and sub-division (2) of that divi",
        similarity: 0.62,
      },
      {
        kind: 'caselaw',
        label: "Telstra Corporation Limited v Albert John Rea [2002] NSWCA 49",
        pinpoint: "at [93]",
        snippet: "There is a further 3-year limitation period imposed after the point at which the plaintiff becomes aware of certain matters in relation to his injury. More specifically, the court may not make an order extending the peri",
        similarity: 0.62,
      },
      {
        kind: 'caselaw',
        label: "Tran v Au-Yong; Tran v Au [2008] NSWSC 396",
        pinpoint: "at [31]",
        snippet: "Section 60A of the Limitation Act 1969 (the Act) provides a procedure for a five year (maximum) extension of the three year limitation period for personal injury cases.",
        similarity: 0.65,
      },
      {
        kind: 'caselaw',
        label: "Turagadamudamu v PMP Limited [2009] NSWCA 120",
        pinpoint: "at [15]",
        snippet: "Pursuant to the Limitation Act , s 60C, that period may be extended for a period not exceeding five years. (This has been referred to above as the secondary limitation period.) That section provides: \u201c 60C Ordinary actio",
        similarity: 0.61,
      },
      {
        kind: 'caselaw',
        label: "V Vaccaro & Sons Pty Ltd v Von Marburg [2020] NSWSC 432",
        pinpoint: "at [62]",
        snippet: "(c) The limitation period The relevant limitation period for a cause of action that relates to personal injury expires 3 years after the cause of action is discoverable, or 12 years from the time of the act or omission a",
        similarity: 0.65,
      },
      {
        kind: 'caselaw',
        label: "Statute\nLimitation Act 1969 (NSW) s 60A",
        snippet: "Purpose of this Subdivision Part 3 > Division 3 > Subdivision 2 > s 60A The purpose of this Subdivision is to provide a procedure for a 5 year (maximum) extension of the 3 year limitation period for personal injury cases",
        similarity: 0.5,
      },
      {
        kind: 'caselaw',
        label: "Statute\nLimitation Act 1969 (NSW) s 58",
        snippet: "Ordinary action Part 3 > Division 3 > Subdivision 1 > s 58 (1) This section applies to a cause of action founded on negligence nuisance or breach of duty, for damages for personal injury, not being a cause of action whic",
        similarity: 0.47,
      },
      {
        kind: 'caselaw',
        label: "Statute\nLimitation Act 1969 (NSW) sch 5 cl 4",
        snippet: "Existing causes of action for personal injuries may be extended where latent injury etc Sch 5 > Pt 1 > Cl 4 (1) Section 60G also applies to a cause of action, founded on negligence, nuisance or breach of duty, being a ca",
        similarity: 0.47,
      },
      {
        kind: 'caselaw',
        label: "Statute\nLimitation Act 1969 (NSW) s 60C",
        snippet: "Ordinary action (including surviving action) Part 3 > Division 3 > Subdivision 2 > s 60C (1) This section applies to a cause of action, founded on negligence, nuisance or breach of duty, for damages for personal injury, ",
        similarity: 0.47,
      },
    ],
  },
  {
    id: 'peer-professional-opinion',
    question: "What is the standard of care for medical professionals, and how does the peer professional opinion defence operate?",
    mode: 'Barrister',
    showcases:
      "Authorities in strict court-hierarchy order, with the statute leading and the contrary case addressed.",
    answer: `Standard of Care for Medical Professionals and the Peer Professional Opinion Defence (NSW)
1. Short Answer
Under NSW law, a medical professional will not be liable in negligence if it is established that they acted in a manner widely accepted in Australia by peer professional opinion as competent professional practice, provided that opinion is not irrational. This statutory standard, found in s 5O of the *Civil Liability Act 2002* (NSW), operates as a defence — the onus of establishing it rests on the defendant professional, not the plaintiff.

2. The Law
Governing Provision
Section 5O of the *Civil Liability Act 2002* (NSW) [11] provides:

"(1) A person practising a profession (a professional) does not incur a liability in negligence arising from the provision of a professional service if it is established that the professional acted in a manner that (at the time the service was provided) was widely accepted in Australia by peer professional opinion as competent professional practice.

(2) However, peer professional opinion cannot be relied on for the purposes of this section if the court considers that the opinion is irrational.

(3) The fact that there are differing peer professional opinions widely accepted in Australia concerning a matter does not prevent any one or more (or all) of those opinions being relied on for the purposes of this section.

(4) Peer professional opinion does not have to be universally accepted to be considered widely accepted."

Key Interpretive Authorities (Court Hierarchy Order)
**NSW Court of Appeal — *Dobler v Halverson* [2007] NSWCA 335**

This is the leading authority on the construction and operation of s 5O. Three propositions emerge from it:

Section 5O is a defence, not a duty-defining provision. The Court expressly rejected the argument that s 5O merely defines the content of the duty of care. Instead, it "provides a defence": [2][5][6]. The legislative history — including the second reading speech and the Ipp Review — was considered and confirmed this reading [2].
Onus lies on the defendant. Because s 5O operates as a defence, it is the defendant who must establish (in practice, by calling expert evidence) that their conduct was widely accepted by peer professional opinion as competent practice [5][6]. The plaintiff is not required to identify and negate a different professional practice favourable to the defendant [5].
The ultimate standard remains for the court. Section 5O may determine the defendant's standard of care, but "the standard of care will be that determined by the court with guidance from evidence of acceptable professional practice" unless the defendant establishes the s 5O defence [6]. Requiring the plaintiff to prove the negative "would significantly distort the language of s 5O(1)" [6].
**NSW Court of Appeal — *Sydney South West Area Health Service v MD* [2009] NSWCA 343**

Confirms that a defence relying on s 5O must be properly pleaded — specifically, the defence must both invoke s 5O and allege the facts required by s 5O(1) [1]. Failure to plead the defence or those facts is a procedural deficiency that may foreclose reliance on it.

**NSW Court of Appeal — *Weller v Phipps* [2010] NSWCA 323**

Illustrates that the defence is properly raised in a defence to an amended statement of claim and is assessed against the evidence adduced at trial [4].

**NSW Court of Appeal — *Sarian v Elton* [2011] NSWCA 123**

Further confirms the operation of s 5O in contested medical negligence proceedings, particularly in relation to the assessment of medical evidence [8].

**NSW Supreme Court — *Wei Fan v South Eastern Sydney Local Health District (No 2)* [2015] NSWSC 1235**

Notes the pre-*Civil Liability Act* position under *Rogers v Whitaker* (that the standard was not determined solely by reference to a responsible body of professional opinion) and confirms that s 5O has modified that position: a professional will not be liable if the s 5O defence is made out [10].

**NSW Supreme Court — *Melchior v Sydney Adventist Hospital* [2008] NSWSC 1282**

Illustrates the defence succeeding on the evidence where peer professional opinion clearly supported the defendant's conduct [7].

3. Application
The operation of s 5O in practice works as follows:

Stage	Who acts	What is required
Plaintiff's case	Plaintiff	Calls expert evidence that defendant's conduct fell short of acceptable professional practice [5]
Defendant's case	Defendant	Calls expert evidence that conduct was widely accepted by peer professional opinion as competent practice [5][6]
Court's assessment	Court	Determines whether the opinion is rational [11]; if so, and if widely accepted (not necessarily universally [11]), the defence is established
Effect	—	Defendant escapes liability in negligence [11]
Critically, the existence of differing peer professional opinions does not defeat the defence — each opinion may independently satisfy s 5O, provided it is widely accepted and rational [11][3]. The defence is available even where there is no single dominant professional view.

4. What Would Change This
Several matters could affect the analysis and must be independently verified:

Rationality of the opinion. The court retains a gatekeeping role under s 5O(2) [11]. If peer professional opinion is found irrational, it cannot be relied upon. The retrieved sources do not provide detailed guidance on how courts assess irrationality — further research into specific factual contexts is warranted.
Pleading requirements. The defence must be expressly pleaded, and the relevant facts must be alleged [1]. A defendant who does not plead s 5O may be unable to rely on it.
Scope: "provision of a professional service." Section 5O applies to professional services specifically [11]. Whether particular conduct constitutes a "professional service" in a given factual context may require analysis — this boundary was not directly addressed in the retrieved sources.
Neighbouring provisions not retrieved. Division 6 of Part 1A of the *Civil Liability Act 2002* contains s 5O and may contain adjacent provisions (such as application, exclusion or interaction provisions) that qualify its operation. Those sections were not retrieved for this query and must be checked directly in the Act before advising.
Interaction with disclosure/consent obligations. The pre-Act duty to warn established in *Rogers v Whitaker* operates in a different domain (informed consent) and s 5O's interaction with disclosure obligations was not addressed in the retrieved sources. This requires separate research.
Jurisdiction. The sources retrieved are NSW authorities applying NSW legislation. If the matter arises in another jurisdiction, different provisions will apply and were not retrieved.
*This is research assistance only, not legal advice. All citations should be verified against official sources (NSW Caselaw, Legislation NSW) before reliance. Note that some retrieved judgments pre-date 2015 and were surfaced via the available index — the caselaw database otherwise focuses on NSW Supreme Court judgments from 2015 onward, so earlier Court of Appeal authority on this topic should be verified directly.*`,
    sources: [
      {
        kind: 'caselaw',
        label: "Sydney South West Area Health Service v MD [2009] NSWCA 343",
        pinpoint: "at [12]",
        snippet: "The respondent\u2019s statement of claim alleged a duty of care and breach. Dr Fulcher\u2019s defence admitted the duty of care and denied breach. It made no reference to s 5O of the Civil Liability Act 2002, which provides as fol",
        similarity: 0.7,
      },
      {
        kind: 'caselaw',
        label: "Dobler v Kenneth Halverson and Ors; Dobler v Kurt Halverson (by his tutor) [2007] NSWCA 335",
        pinpoint: "at [63]",
        snippet: "The appellant\u2019s arguments had the difficulty that para 3.22 of the Review states that the recommended rule which (at least conceptually) became s 5O \u201cprovides a defence for any medical practitioner whose treatment is sup",
        similarity: 0.69,
      },
      {
        kind: 'caselaw',
        label: "Dobler v Kenneth Halverson and Ors; Dobler v Kurt Halverson (by his tutor) [2007] NSWCA 335",
        pinpoint: "at [36]",
        snippet: "Section 5O of the Civil Liability Act modified this in stating a standard of widely accepted peer professional opinion so long as it was rational opinion. It provided - \u201c 5O Standard of care for professionals (1) A perso",
        similarity: 0.68,
      },
      {
        kind: 'caselaw',
        label: "Weller v Phipps [2010] NSWCA 323",
        pinpoint: "at [45]",
        snippet: "The defence to that amended statement of claim relied inter alia on s 5O of the Civil Liability Act 2002, which is in the following terms: 5O Standard of care for professionals (1) A person practising a profession ( a pr",
        similarity: 0.68,
      },
      {
        kind: 'caselaw',
        label: "Dobler v Kenneth Halverson and Ors; Dobler v Kurt Halverson (by his tutor) [2007] NSWCA 335",
        pinpoint: "at [60]",
        snippet: "In this sense, s 5O provides a defence. The plaintiff will usually call his expert evidence to the effect that the defendant\u2019s conduct fell short of acceptable professional practice, and will invite the court to determin",
        similarity: 0.67,
      },
      {
        kind: 'caselaw',
        label: "Dobler v Kenneth Halverson and Ors; Dobler v Kurt Halverson (by his tutor) [2007] NSWCA 335",
        pinpoint: "at [61]",
        snippet: "It follows that I do not accept the appellant\u2019s submission that s 5O did not provide a defence but defined the content of the duty of care owed by the appellant to Kurt, with the onus on the respondents to prove that the",
        similarity: 0.67,
      },
      {
        kind: 'caselaw',
        label: "Melchior and Ors v Sydney Adventist Hospital Ltd and Anor [2008] NSWSC 1282",
        pinpoint: "at [140]",
        snippet: "If I am wrong in that conclusion, the evidence clearly establishes the defence in s 5O of the Civil Liability Act 2002. \u201c5O Standard of care for professionals (1) A person practising a profession ( a professional ) does ",
        similarity: 0.7,
      },
      {
        kind: 'caselaw',
        label: "Sarian v Elton [2011] NSWCA 123",
        pinpoint: "at [158]",
        snippet: "Primary judge's response to the medical evidence Section 5O provides: \"5O(1) A person practising a profession (a professional) does not incur a liability in negligence arising from the provision of a professional service",
        similarity: 0.65,
      },
      {
        kind: 'caselaw',
        label: "Dobler v Kenneth Halverson and Ors; Dobler v Kurt Halverson (by his tutor) [2007] NSWCA 335",
        pinpoint: "at [106]",
        snippet: "It may be that the explanation lies in the basis on which the general practitioners were giving their evidence. They consulted in conclave and produced answers to questions. The document recording the questions and answe",
        similarity: 0.65,
      },
      {
        kind: 'caselaw',
        label: "Wei Fan v South Eastern Sydney Local Health District (No 2) [2015] NSWSC 1235",
        pinpoint: "at [44]",
        snippet: "Duty and standard of care In Rogers v Whitaker, Mason CJ continued at 487, that \u201cthat standard is not determined solely or even primarily by reference to the practice followed or supported by a responsible body of opinio",
        similarity: 0.68,
      },
      {
        kind: 'caselaw',
        label: "Statute\nCivil Liability Act 2002 (NSW) s 5O",
        snippet: "Standard of care for professionals Part 1A > Division 6 > s 5O (1) A person practising a profession (a professional) does not incur a liability in negligence arising from the provision of a professional service if it is ",
        similarity: 0.57,
      },
    ],
  },
];

/** Lookup helper for the demo page. */
export function getDemoAnswer(id: string): DemoAnswer | undefined {
  return DEMO_ANSWERS.find((a) => a.id === id);
}