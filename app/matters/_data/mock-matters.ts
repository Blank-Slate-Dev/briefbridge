// app/matters/_data/mock-matters.ts
//
// PLACEHOLDER DATA — DELETE ME WHEN AUTH + MATTERS TABLE GO LIVE.
//
// Centralised mock data so the matter list and matter detail page stay in
// sync. Once authentication and the matters table are added, this file gets
// replaced by a real DB query helper and the rest of the UI doesn't need to
// know the difference.

export interface MockMatter {
  id: string;
  name: string;
  client: string;
  description: string;
  status: 'active' | 'on-hold' | 'archived';
  /** Human-readable, e.g. "2 hours ago". */
  lastActivity: string;
  fileCount: number;
  conversationCount: number;
  citedAuthorities: number;
  /** One-line preview of the most recent activity in this matter. */
  recentActivity: string;
  /** Free-form overview shown on the detail page. Markdown is NOT rendered. */
  overview: string;
  /** When the matter was created (display-only). */
  openedOn: string;
  /** Mock files attached to this matter. */
  files: MockFile[];
  /** Mock recent conversations. */
  conversations: MockConversation[];
  /** Cited authorities surfaced across this matter's research. */
  authorities: MockAuthority[];
  /** Free-form notes. */
  notes: string;
}

export interface MockFile {
  id: string;
  name: string;
  /** e.g. "Pleading", "Evidence", "Correspondence". */
  category: string;
  /** Human-readable size, e.g. "1.2 MB". */
  size: string;
  uploadedAt: string;
}

export interface MockConversation {
  id: string;
  /** A summary of what the conversation was about. */
  title: string;
  /** Most recent activity timestamp (display-only). */
  updatedAt: string;
  /** A short preview snippet from the conversation. */
  preview: string;
  /** Total messages in the conversation. */
  messageCount: number;
}

export interface MockAuthority {
  /** Case name in italics. */
  name: string;
  /** Medium neutral citation. */
  citation: string;
  /** What this case stood for in this matter — short. */
  proposition: string;
  /** Times this authority appeared across the matter's research. */
  citedTimes: number;
}

// =============================================================================
// The data
// =============================================================================

export const MOCK_MATTERS: MockMatter[] = [
  {
    id: 'smith-jones-2026',
    name: 'Smith v Jones',
    client: 'Smith Properties Pty Ltd',
    description:
      'Application for security for costs against a third-party-funded plaintiff in liquidation. ATE policy adequacy in dispute.',
    status: 'active',
    lastActivity: '2 hours ago',
    fileCount: 8,
    conversationCount: 14,
    citedAuthorities: 23,
    recentActivity:
      'Researched English authorities on anti-avoidance endorsements',
    openedOn: '14 March 2026',
    overview:
      'Defendant is a developer sued by an insolvent corporate plaintiff funded by LCM. The plaintiff has offered an ATE policy from overseas Lloyd\'s syndicates as security for our client\'s costs. We need to advise whether to accept the policy or insist on conventional security (bank guarantee or payment into court).',
    files: [
      {
        id: 'f1',
        name: 'Statement of Claim — 14 Mar 2026.pdf',
        category: 'Pleading',
        size: '420 KB',
        uploadedAt: '14 Mar 2026',
      },
      {
        id: 'f2',
        name: 'Defence — draft v3.docx',
        category: 'Pleading',
        size: '180 KB',
        uploadedAt: '22 Apr 2026',
      },
      {
        id: 'f3',
        name: 'ATE Policy — Lloyd\'s Syndicate 4242.pdf',
        category: 'Evidence',
        size: '2.1 MB',
        uploadedAt: '28 Apr 2026',
      },
      {
        id: 'f4',
        name: 'Funding Agreement — LCM Funding.pdf',
        category: 'Evidence',
        size: '1.4 MB',
        uploadedAt: '28 Apr 2026',
      },
      {
        id: 'f5',
        name: 'Counsel\'s opinion — security for costs.pdf',
        category: 'Advice',
        size: '320 KB',
        uploadedAt: '5 May 2026',
      },
      {
        id: 'f6',
        name: 'Witness statement — David Smith.docx',
        category: 'Evidence',
        size: '290 KB',
        uploadedAt: '7 May 2026',
      },
      {
        id: 'f7',
        name: 'Open offer correspondence — May 2026.pdf',
        category: 'Correspondence',
        size: '95 KB',
        uploadedAt: '8 May 2026',
      },
      {
        id: 'f8',
        name: 'Schedule of estimated costs.xlsx',
        category: 'Costs',
        size: '45 KB',
        uploadedAt: '9 May 2026',
      },
    ],
    conversations: [
      {
        id: 'c1',
        title: 'English authorities on ATE anti-avoidance endorsements',
        updatedAt: '2 hours ago',
        preview:
          'Compared Musst Holdings, Saxon Woods, Asertis, and Premier Motor Auctions on policy enforceability. Asertis confirms direct enforcement is the threshold issue...',
        messageCount: 8,
      },
      {
        id: 'c2',
        title: 'NSW position on ATE policies as security',
        updatedAt: '6 hours ago',
        preview:
          'i-Prosperity v Crown Melbourne is the leading NSW authority. The court applies a three-part test focused on legitimate contestability...',
        messageCount: 12,
      },
      {
        id: 'c3',
        title: 'Strategy: accept policy vs insist on bank guarantee',
        updatedAt: 'Yesterday',
        preview:
          'Drafted analytical framework weighing direct enforceability against the funder\'s position. Recommendation: reject the ATE policy and demand...',
        messageCount: 6,
      },
      {
        id: 'c4',
        title: 'Lloyd\'s syndicate authorisation in Australia',
        updatedAt: '2 days ago',
        preview:
          'Confirmed APRA approval status of the relevant syndicates. Lloyd\'s Australia Cover Holder arrangements affect direct enforceability...',
        messageCount: 5,
      },
    ],
    authorities: [
      {
        name: 'i-Prosperity Pty Ltd v Crown Melbourne Ltd',
        citation: '[2025] NSWSC 1525',
        proposition: 'Three-part test for ATE policy adequacy as security for costs.',
        citedTimes: 9,
      },
      {
        name: 'Musst Holdings Ltd v Astra Asset Management Ltd',
        citation: '[2024] EWHC 2310 (Ch)',
        proposition: 'Anti-avoidance endorsement found adequate on analysis of policy terms.',
        citedTimes: 4,
      },
      {
        name: 'Saxon Woods Investments Ltd v Costa',
        citation: '[2023] EWHC 850 (Ch)',
        proposition: 'Articulates analytical framework for policy adequacy.',
        citedTimes: 3,
      },
      {
        name: 'Asertis Ltd v Bloch',
        citation: '[2024] EWHC 2393 (Ch)',
        proposition: 'Policy inadequate where defendant has no direct enforcement right.',
        citedTimes: 5,
      },
      {
        name: 'Premier Motor Auctions Ltd v PwC',
        citation: '[2018] 1 WLR 2955',
        proposition: 'Absence of an anti-avoidance clause is fatal to adequacy.',
        citedTimes: 2,
      },
    ],
    notes:
      'Client wants to be aggressive on security. Bank guarantee for full quantum is the preferred outcome — anything less requires sign-off. Watch for: opponent may argue overseas-syndicate concerns are overstated given Lloyd\'s Australia arrangements. Counter: enforcement still requires litigation in England; substitute risk is real.',
  },
  {
    id: 'williams-contract',
    name: 'Williams — Contract Dispute',
    client: 'Williams Engineering',
    description:
      'Alleged breach of warranty in commercial supply contract. Limitation of liability clause and consequential loss exclusions in issue.',
    status: 'active',
    lastActivity: 'Yesterday',
    fileCount: 12,
    conversationCount: 7,
    citedAuthorities: 11,
    recentActivity: 'Drafted advice on consequential loss test',
    openedOn: '8 February 2026',
    overview:
      'Client supplied bespoke pumps under a 2024 supply agreement. Counter-party claims pumps failed to meet warranted performance specifications and seeks damages including loss of plant downtime and replacement equipment. Limitation of liability clause caps direct losses at contract price; excludes consequential loss. Issue: which losses fall within "consequential".',
    files: [
      {
        id: 'f1',
        name: 'Supply Agreement — fully executed.pdf',
        category: 'Contract',
        size: '1.8 MB',
        uploadedAt: '8 Feb 2026',
      },
      {
        id: 'f2',
        name: 'Letter of demand — counter-party.pdf',
        category: 'Correspondence',
        size: '210 KB',
        uploadedAt: '15 Feb 2026',
      },
      {
        id: 'f3',
        name: 'Performance test reports.pdf',
        category: 'Evidence',
        size: '4.2 MB',
        uploadedAt: '22 Feb 2026',
      },
    ],
    conversations: [
      {
        id: 'c1',
        title: 'Australian position on consequential loss',
        updatedAt: 'Yesterday',
        preview:
          'Environmental Systems v Peerless and the move away from Hadley v Baxendale\'s second limb...',
        messageCount: 9,
      },
      {
        id: 'c2',
        title: 'Validity of limitation of liability clauses post-ACL',
        updatedAt: '3 days ago',
        preview:
          'Whether the cap on damages survives unfair contract terms regime in B2B context...',
        messageCount: 6,
      },
    ],
    authorities: [
      {
        name: 'Environmental Systems Pty Ltd v Peerless Holdings Pty Ltd',
        citation: '[2008] VSCA 26',
        proposition: 'Australian approach to "consequential loss" — depart from Hadley v Baxendale second limb.',
        citedTimes: 6,
      },
      {
        name: 'Allianz Australia Insurance Ltd v Waterbrook at Yowie Bay Pty Ltd',
        citation: '[2009] NSWCA 224',
        proposition: 'Application of consequential loss exclusion in commercial contracts.',
        citedTimes: 3,
      },
    ],
    notes:
      'Strong case on the wording of the clause. Risk is in characterisation of plant downtime as "direct" rather than "consequential". Need to be ready to argue both ways depending on how counter-party frames it.',
  },
  {
    id: 'tran-property',
    name: 'Tran — Property Settlement',
    client: 'Linh Tran',
    description:
      'Family Court property settlement. Non-disclosure of trust assets by respondent. Application for production of trust documents.',
    status: 'on-hold',
    lastActivity: '5 days ago',
    fileCount: 4,
    conversationCount: 3,
    citedAuthorities: 6,
    recentActivity: 'Awaiting client instructions on settlement offer',
    openedOn: '11 January 2026',
    overview:
      'Parties married 14 years, separated 2024. Respondent (former husband) is a director of a discretionary trust which on its face holds significant assets. Client suspects the trust was used to shield matrimonial property. Issue: getting at the trust assets via Family Court production powers vs forcing acknowledgement of beneficial interest.',
    files: [
      {
        id: 'f1',
        name: 'Initiating Application — Tran.pdf',
        category: 'Pleading',
        size: '380 KB',
        uploadedAt: '11 Jan 2026',
      },
      {
        id: 'f2',
        name: 'Form 13 financial disclosure.pdf',
        category: 'Disclosure',
        size: '520 KB',
        uploadedAt: '15 Feb 2026',
      },
    ],
    conversations: [
      {
        id: 'c1',
        title: 'Piercing the corporate veil — discretionary trusts',
        updatedAt: '5 days ago',
        preview:
          'Kennon v Spry remains the leading authority. Whether the trustee\'s discretion can be treated as property of the parties...',
        messageCount: 7,
      },
    ],
    authorities: [
      {
        name: 'Kennon v Spry',
        citation: '(2008) 238 CLR 366',
        proposition: 'Trustee\'s power of appointment in a discretionary trust may constitute property of the parties to a marriage.',
        citedTimes: 4,
      },
    ],
    notes:
      'Awaiting client decision on whether to settle on disclosed assets only or push for full trust production. Hold-on-file pending instructions due 14 May.',
  },
];

export function findMockMatter(id: string): MockMatter | undefined {
  return MOCK_MATTERS.find((m) => m.id === id);
}
