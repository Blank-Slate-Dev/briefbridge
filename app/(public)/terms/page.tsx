// app/terms/page.tsx
//
// Terms of Service — public page. Extensive coverage adapted for AI legal
// research: no-legal-advice, verification obligation, confidentiality,
// ACL-compliant liability structure, indemnities, termination mechanics.
//
// ⚠ DRAFT FOR LEGAL REVIEW before commercial reliance.

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The terms that govern your use of the BriefBridge platform.',
  alternates: { canonical: '/terms' },
};

const NAVY = '#1a1f2e';
const SOFT = '#3a4256';
const MUTED = '#8a8577';
const GOLD = '#c9a24b';
const BORDER = '#e7e0d2';
const SERIF = 'var(--font-fraunces), Georgia, serif';

const S = {
  page: { background: '#f4efe6', minHeight: '100vh', padding: '3.5rem 1.5rem 5rem', color: SOFT } as const,
  wrap: { maxWidth: 860, margin: '0 auto' } as const,
  card: { background: '#fff', border: `1px solid ${BORDER}`, borderTop: `4px solid ${GOLD}`, borderRadius: 16, padding: '3rem 3.25rem' } as const,
  h1: { fontFamily: SERIF, fontSize: '2.3rem', color: NAVY, margin: '0 0 .3rem', lineHeight: 1.2 } as const,
  meta: { fontSize: '.85rem', color: MUTED, marginBottom: '2.25rem' } as const,
  h2: { fontFamily: SERIF, fontSize: '1.3rem', color: NAVY, marginTop: '2.75rem', marginBottom: '.75rem', paddingBottom: '.4rem', borderBottom: `1px solid ${BORDER}` } as const,
  h3: { fontFamily: SERIF, fontSize: '1.02rem', color: NAVY, marginTop: '1.5rem', marginBottom: '.4rem' } as const,
  p: { fontSize: '.95rem', lineHeight: 1.75, margin: '.65rem 0' } as const,
  li: { fontSize: '.95rem', lineHeight: 1.75, margin: '.35rem 0' } as const,
  strong: { color: NAVY, fontWeight: 600 } as const,
  tocBox: { background: '#faf7f0', border: `1px solid ${BORDER}`, borderRadius: 12, padding: '1.25rem 1.75rem', margin: '1.75rem 0 0' } as const,
  tocLink: { color: NAVY, textDecoration: 'none', fontSize: '.9rem', lineHeight: 1.9 } as const,
  callout: { background: '#faf6ec', border: `1px solid ${GOLD}`, borderRadius: 10, padding: '1.1rem 1.4rem', fontSize: '.95rem', lineHeight: 1.7, margin: '1.1rem 0' } as const,
};

const TOC = [
  ['1', 'Agreement and eligibility'],
  ['2', 'Definitions'],
  ['3', 'The service'],
  ['4', 'Research tool — not legal advice'],
  ['5', 'Accounts and security'],
  ['6', 'Firm workspaces'],
  ['7', 'Your Content: ownership, licence and responsibilities'],
  ['8', 'Confidentiality'],
  ['9', 'Acceptable use'],
  ['10', 'Fees, trials, billing and cancellation'],
  ['11', 'Intellectual property'],
  ['12', 'Third-party services'],
  ['13', 'Availability, changes and beta features'],
  ['14', 'Suspension and termination'],
  ['15', 'Warranties and disclaimers'],
  ['16', 'Liability'],
  ['17', 'Indemnity'],
  ['18', 'General'],
  ['19', 'Contact'],
];

export default function TermsPage() {
  return (
    <div style={S.page}>
      <div style={S.wrap}>
        <div style={S.card}>
          <h1 style={S.h1}>Terms of Service</h1>
          <p style={S.meta}>BriefBridge · briefbridge.ai · Last updated 19 July 2026</p>

          <p style={S.p}>
            These terms are a binding agreement between you and BriefBridge
            (“<span style={S.strong}>BriefBridge</span>”, “we”, “us”, “our”)
            governing your access to and use of the BriefBridge platform at
            briefbridge.ai (the “<span style={S.strong}>Platform</span>”). By
            creating an account or using the Platform you agree to these
            terms and to our <Link href="/privacy" style={{ color: NAVY }}>Privacy
            Policy</Link>. If you do not agree, do not use the Platform.
          </p>

          <nav style={S.tocBox} aria-label="Contents">
            <div style={{ fontFamily: SERIF, color: NAVY, fontSize: '1rem', marginBottom: '.4rem' }}>Contents</div>
            {TOC.map(([n, label]) => (
              <div key={n}>
                <a href={`#t${n}`} style={S.tocLink}>{n}. {label}</a>
              </div>
            ))}
          </nav>

          <h2 style={S.h2} id="t1">1. Agreement and eligibility</h2>
          <ul>
            <li style={S.li}>You must be at least 18 years old and capable of entering a binding agreement.</li>
            <li style={S.li}>The Platform is designed for legal practitioners, legal researchers and others conducting legal research. If you use it in the course of legal practice, you are responsible for compliance with the professional conduct rules applying to you.</li>
            <li style={S.li}>If you accept these terms on behalf of a firm or other entity, you warrant that you have authority to bind it, and “you” includes that entity.</li>
          </ul>

          <h2 style={S.h2} id="t2">2. Definitions</h2>
          <ul>
            <li style={S.li}><span style={S.strong}>Your Content</span> — the matters, documents, files, research questions, conversations and notes you upload to or create on the Platform.</li>
            <li style={S.li}><span style={S.strong}>Outputs</span> — AI-assisted research responses, summaries and other material generated by the Platform in response to your use.</li>
            <li style={S.li}><span style={S.strong}>Corpus</span> — the collection of court judgments, legislation and associated enrichment (summaries, links, citation data, embeddings) made searchable by the Platform.</li>
            <li style={S.li}><span style={S.strong}>ACL</span> — the Australian Consumer Law (Schedule 2 to the Competition and Consumer Act 2010 (Cth)).</li>
          </ul>

          <h2 style={S.h2} id="t3">3. The service</h2>
          <p style={S.p}>
            The Platform provides AI-assisted semantic research across the
            Corpus, together with matter and document workspace features.
            Court judgments and legislation in the Corpus are reproduced from
            official public sources; legislative material is used under
            Creative Commons Attribution 4.0 and other applicable government
            licensing, and remains subject to its own terms. The Corpus does
            not include every decision or instrument; coverage is described
            in the Platform and may change.
          </p>

          <h2 style={S.h2} id="t4">4. Research tool — not legal advice</h2>
          <div style={S.callout}>
            <p style={{ ...S.p, margin: 0 }}>
              <span style={S.strong}>The Platform is a research tool. It is
              not a lawyer, does not provide legal advice, and no
              solicitor–client, fiduciary or advisory relationship is created
              between you and BriefBridge.</span> Outputs are generated with
              the assistance of artificial intelligence and may contain
              errors, omissions, misdescriptions of authorities, or
              out-of-date statements of law.
            </p>
          </div>
          <p style={S.p}>You acknowledge and agree that:</p>
          <ul>
            <li style={S.li}><span style={S.strong}>Verification obligation.</span> You must independently verify every authority, citation, quotation and proposition against official sources before relying on it or putting it before a court, client or counterparty.</li>
            <li style={S.li}><span style={S.strong}>Professional responsibility.</span> You remain solely responsible for all professional work product, advice, court documents and decisions you produce, and for compliance with your professional obligations — including obligations of competence, supervision of tools, and candour to the court.</li>
            <li style={S.li}><span style={S.strong}>Currency.</span> Legislation and caselaw change. The Corpus is updated periodically but may not reflect the law at the moment you use it.</li>
            <li style={S.li}><span style={S.strong}>No reliance.</span> To the maximum extent permitted by law, you use Outputs at your own risk and must not treat them as a substitute for professional judgement or advice.</li>
          </ul>

          <h2 style={S.h2} id="t5">5. Accounts and security</h2>
          <ul>
            <li style={S.li}>Registration information must be accurate and kept current.</li>
            <li style={S.li}>You are responsible for maintaining the confidentiality of your credentials and for all activity under your account. Notify us immediately of any suspected unauthorised access.</li>
            <li style={S.li}>We may require reasonable identity verification for support requests affecting account data.</li>
          </ul>

          <h2 style={S.h2} id="t6">6. Firm workspaces</h2>
          <ul>
            <li style={S.li}>A firm workspace allows matters to be shared among firm members. Content shared to a firm matter is visible to the members it is shared with; unshared content remains personal to your account.</li>
            <li style={S.li}>Firm administrators are responsible for managing membership and for their firm's compliance with its own confidentiality and privacy obligations.</li>
            <li style={S.li}>If you leave a firm workspace, you lose access to that firm's shared matters; your personal content remains yours.</li>
          </ul>

          <h2 style={S.h2} id="t7">7. Your Content: ownership, licence and responsibilities</h2>
          <ul>
            <li style={S.li}><span style={S.strong}>You own Your Content.</span> These terms transfer no ownership to us.</li>
            <li style={S.li}><span style={S.strong}>Limited licence to us.</span> You grant us a non-exclusive, worldwide, royalty-free licence to host, store, process, transmit and display Your Content solely as necessary to provide the Platform to you and your authorised firm members, and for no other purpose. The licence ends when the relevant content is deleted, subject to backup rotation cycles.</li>
            <li style={S.li}><span style={S.strong}>No training.</span> We do not use Your Content to train, fine-tune or evaluate AI models, and our contracts with AI providers preclude their doing so with API data.</li>
            <li style={S.li}><span style={S.strong}>Your responsibilities.</span> You warrant that you are entitled to upload the material you upload, and that your use complies with your obligations of confidentiality, any applicable court orders (including suppression and non-publication orders), and applicable law. You are responsible for judgements about what material is appropriate to process through any third-party tool.</li>
            <li style={S.li}><span style={S.strong}>Export and deletion.</span> You can delete Your Content at any time, and can export it before closing your account (§14).</li>
          </ul>

          <h2 style={S.h2} id="t8">8. Confidentiality</h2>
          <p style={S.p}>
            We treat Your Content as your confidential information. We will
            not access, use or disclose it except: as necessary to provide
            the Platform; to respond to support you request; to investigate
            suspected abuse, fraud or security incidents; or as required by
            law — and in the case of compulsory legal process, we will
            (unless legally prohibited) notify you before responding so you
            may assert any claim of privilege or objection, and will disclose
            only what we are compelled to disclose. This clause supports —
            and is not a substitute for — your own professional duties. Our
            handling of personal information is governed by our{' '}
            <Link href="/privacy" style={{ color: NAVY }}>Privacy Policy</Link>.
          </p>

          <h2 style={S.h2} id="t9">9. Acceptable use</h2>
          <p style={S.p}>You must not, and must not permit anyone to:</p>
          <ul>
            <li style={S.li}>use the Platform in breach of law, professional conduct rules, or court orders;</li>
            <li style={S.li}>upload material you are not entitled to upload, or material containing malware or harmful code;</li>
            <li style={S.li}>attempt to gain unauthorised access to the Platform, other users' data, or our infrastructure, or probe, scan or test vulnerabilities other than through any authorised disclosure process;</li>
            <li style={S.li}>scrape, bulk-download, or systematically extract the Corpus or Outputs, or use them to build or train a competing database, product or model;</li>
            <li style={S.li}>resell, sublicense or provide the Platform to third parties except through firm features;</li>
            <li style={S.li}>use the Platform to generate material you present as issued by a court or official source, or misrepresent AI-generated material as such;</li>
            <li style={S.li}>interfere with the integrity or performance of the Platform, including by imposing unreasonable load.</li>
          </ul>

          <h2 style={S.h2} id="t10">10. Fees, trials, billing and cancellation</h2>
          <ul>
            <li style={S.li}><span style={S.strong}>Plans and pricing</span> are as described at purchase. Fees are in Australian dollars and inclusive of GST unless stated otherwise.</li>
            <li style={S.li}><span style={S.strong}>Trials.</span> Where we offer a free trial, paid billing begins only when the trial converts as described at signup.</li>
            <li style={S.li}><span style={S.strong}>Billing.</span> Subscriptions bill in advance on a recurring basis and renew automatically until cancelled. Taxes we are required to collect are added at checkout.</li>
            <li style={S.li}><span style={S.strong}>Cancellation.</span> You may cancel at any time, effective at the end of the current billing period; access continues to the period's end. Fees already paid are non-refundable except as required by the ACL or expressly stated.</li>
            <li style={S.li}><span style={S.strong}>Changes.</span> We may change pricing on at least 30 days' notice; changes apply from your next billing cycle. If you do not accept a change, cancel before it takes effect.</li>
            <li style={S.li}><span style={S.strong}>Non-payment.</span> We may suspend access for overdue amounts after reasonable notice.</li>
          </ul>

          <h2 style={S.h2} id="t11">11. Intellectual property</h2>
          <ul>
            <li style={S.li}>We and our licensors own the Platform — its software, design, models of organisation, and the selection, compilation, enrichment and arrangement of the Corpus. These terms grant you only the right to use the Platform in accordance with them; no other rights are transferred.</li>
            <li style={S.li}>Underlying judgments and legislation remain subject to their own public licensing (including Crown copyright and CC BY 4.0 for legislative material), and nothing in these terms restricts your rights under those licences obtained directly from official sources.</li>
            <li style={S.li}><span style={S.strong}>Feedback.</span> If you give us feedback or suggestions, we may use them without restriction or obligation, but doing so will never involve disclosure of Your Content.</li>
            <li style={S.li}>You must not remove or obscure proprietary notices, and must not use our name, logo or branding without written consent, except to truthfully identify that you use the Platform.</li>
          </ul>

          <h2 style={S.h2} id="t12">12. Third-party services</h2>
          <p style={S.p}>
            The Platform depends on third-party infrastructure (hosting,
            database, AI model and email providers, described in our Privacy
            Policy) and may link to external sites, including official
            legislation and court websites. We are not responsible for
            external sites' content. Where a third-party outage affects the
            Platform, §13 and §16 apply.
          </p>

          <h2 style={S.h2} id="t13">13. Availability, changes and beta features</h2>
          <ul>
            <li style={S.li}>We aim for high availability but do not guarantee the Platform will be uninterrupted or error-free. Planned maintenance will be scheduled to minimise disruption where practicable.</li>
            <li style={S.li}>We may add, modify or discontinue features. If we discontinue a feature material to your use, we will give reasonable notice where practicable.</li>
            <li style={S.li}>Features identified as beta, preview or experimental are provided for evaluation, may change or be withdrawn at any time, and are excluded from any service commitments.</li>
          </ul>

          <h2 style={S.h2} id="t14">14. Suspension and termination</h2>
          <ul>
            <li style={S.li}><span style={S.strong}>By you.</span> You may stop using the Platform and close your account at any time.</li>
            <li style={S.li}><span style={S.strong}>By us.</span> We may suspend or terminate your access: for material breach of these terms (with notice and, where the breach is remediable, a reasonable opportunity to remedy); where required by law; or for conduct in §9 creating risk to the Platform or others (immediately, with notice as soon as practicable).</li>
            <li style={S.li}><span style={S.strong}>Effect.</span> On closure, you have a period of at least 30 days to export Your Content (except where termination is for serious unlawful conduct), after which it is deleted in accordance with our Privacy Policy.</li>
            <li style={S.li}><span style={S.strong}>Survival.</span> Sections 4, 7 (warranties), 8, 11, 15–18 survive termination.</li>
          </ul>

          <h2 style={S.h2} id="t15">15. Warranties and disclaimers</h2>
          <p style={S.p}>
            Nothing in these terms excludes, restricts or modifies any
            consumer guarantee, right or remedy under the ACL or other law
            that cannot lawfully be excluded, restricted or modified. Our
            services come with guarantees that cannot be excluded under the
            ACL. Subject to that:
          </p>
          <ul>
            <li style={S.li}>the Platform and Outputs are provided “as is” and “as available”, and we exclude all other conditions, warranties and guarantees, express or implied;</li>
            <li style={S.li}>we do not warrant that Outputs are accurate, complete, current or fit for any particular purpose, or that the Corpus contains any particular decision or instrument;</li>
            <li style={S.li}>where legislation implies a condition or warranty that cannot be excluded but liability can be limited, our liability is limited under §16.</li>
          </ul>

          <h2 style={S.h2} id="t16">16. Liability</h2>
          <ul>
            <li style={S.li}>To the maximum extent permitted by law, we are not liable for: loss arising from reliance on Outputs without independent verification; your professional work product or advice; loss of profits, revenue, goodwill or data; or indirect, incidental, special or consequential loss — however arising, including negligence.</li>
            <li style={S.li}>To the maximum extent permitted by law, our total aggregate liability for all claims arising out of or in connection with the Platform is limited to the greater of (a) the amounts you paid us in the 12 months before the first event giving rise to liability, and (b) AUD $100.</li>
            <li style={S.li}>For goods or services not of a kind ordinarily acquired for personal, domestic or household use, our liability for breach of a non-excludable guarantee is limited (at our option) to re-supplying the services or paying the cost of re-supply, where it is fair and reasonable to do so.</li>
            <li style={S.li}>Each party's liability is reduced proportionately to the extent the other party's acts or omissions caused or contributed to the loss.</li>
          </ul>

          <h2 style={S.h2} id="t17">17. Indemnity</h2>
          <p style={S.p}>
            You indemnify us against liabilities, costs and expenses
            (including reasonable legal costs) arising from third-party
            claims to the extent caused by: your breach of these terms; Your
            Content (including any claim that it infringes rights or was
            uploaded in breach of confidentiality or court orders); or your
            professional use of Outputs — except to the extent we caused the
            relevant loss. We will notify you promptly of any such claim and
            allow you reasonable conduct of the defence.
          </p>

          <h2 style={S.h2} id="t18">18. General</h2>
          <ul>
            <li style={S.li}><span style={S.strong}>Governing law.</span> These terms are governed by the laws of New South Wales, Australia; the parties submit to the non-exclusive jurisdiction of its courts.</li>
            <li style={S.li}><span style={S.strong}>Changes to these terms.</span> We may update these terms. Material changes will be notified in the Platform or by email at least 14 days before taking effect; continued use after that constitutes acceptance. If you do not accept, stop using the Platform and cancel.</li>
            <li style={S.li}><span style={S.strong}>Notices.</span> We give notices in the Platform or to your account email; you give notices to the contact in §19.</li>
            <li style={S.li}><span style={S.strong}>Assignment.</span> You may not assign these terms without our consent. We may assign as part of a bona fide restructure or sale, with notice to you.</li>
            <li style={S.li}><span style={S.strong}>Force majeure.</span> Neither party is liable for delay or failure caused by events beyond its reasonable control, other than payment obligations.</li>
            <li style={S.li}><span style={S.strong}>Severability; waiver; entire agreement.</span> If a provision is unenforceable it is severed and the rest continues; failure to enforce is not waiver; these terms and the Privacy Policy are the entire agreement about the Platform and supersede prior discussions.</li>
          </ul>

          <h2 style={S.h2} id="t19">19. Contact</h2>
          <p style={S.p}>
            Questions about these terms:{' '}
            <a href="mailto:legal@briefbridge.com.au" style={{ color: NAVY }}>legal@briefbridge.com.au</a>.
          </p>

          <p style={{ ...S.p, marginTop: '2.5rem', fontSize: '.85rem', color: MUTED }}>
            See also our <Link href="/privacy" style={{ color: NAVY }}>Privacy Policy</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}