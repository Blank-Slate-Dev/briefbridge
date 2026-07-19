// app/privacy/page.tsx
//
// Privacy Policy — public page. Extensive coverage modelled on Australian
// AI-for-professionals policies (Heidi Health et al), adapted for legal
// practice (confidentiality + legal professional privilege).
//
// ⚠ DRAFT FOR LEGAL REVIEW before commercial reliance. Written to be
// ACCURATE for current architecture (Supabase Singapore; Anthropic/Voyage
// US processing). Update §8 if infrastructure changes.

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'How BriefBridge collects, uses, stores and protects your information — including client-confidential and privileged material.',
  alternates: { canonical: '/privacy' },
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
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '.88rem', margin: '.9rem 0' },
  th: { textAlign: 'left' as const, borderBottom: `2px solid ${BORDER}`, padding: '.5rem .6rem', color: NAVY, fontWeight: 600 },
  td: { borderBottom: `1px solid ${BORDER}`, padding: '.5rem .6rem', verticalAlign: 'top' as const, lineHeight: 1.6 },
};

const TOC = [
  ['1', 'Who we are and how this policy applies'],
  ['2', 'Definitions'],
  ['3', 'Our commitments at a glance'],
  ['4', 'Information we collect'],
  ['5', 'How we use your information'],
  ['6', 'Confidentiality and legal professional privilege'],
  ['7', 'Who we share information with (service providers)'],
  ['8', 'Where your information is stored and processed'],
  ['9', 'How we protect your information'],
  ['10', 'Data retention and deletion'],
  ['11', 'Cookies and website analytics'],
  ['12', 'Direct marketing'],
  ['13', 'Anonymity and pseudonymity'],
  ['14', 'Data breach response'],
  ['15', 'Your rights: access, correction and complaints'],
  ['16', 'Users outside Australia'],
  ['17', 'Changes to this policy'],
  ['18', 'Contact us'],
];

export default function PrivacyPage() {
  return (
    <div style={S.page}>
      <div style={S.wrap}>
        <div style={S.card}>
          <h1 style={S.h1}>Privacy Policy</h1>
          <p style={S.meta}>BriefBridge · briefbridge.ai · Last updated 19 July 2026</p>

          <p style={S.p}>
            BriefBridge is built for lawyers. We know the material you work
            with — client information, matter details, litigation strategy —
            is among the most sensitive information there is, and may be
            subject to strict duties of confidentiality and legal
            professional privilege. We designed BriefBridge, and this policy,
            on that assumption: your content is treated with the same gravity
            as health information, and this document sets out — completely
            and specifically — what we collect, why, where it goes, how it is
            protected, and the rights and choices you have.
          </p>
          <p style={S.p}>
            We handle personal information in accordance with the{' '}
            <span style={S.strong}>Privacy Act 1988 (Cth)</span> and the{' '}
            <span style={S.strong}>Australian Privacy Principles (APPs)</span>,
            and the Notifiable Data Breaches scheme.
          </p>

          <nav style={S.tocBox} aria-label="Contents">
            <div style={{ fontFamily: SERIF, color: NAVY, fontSize: '1rem', marginBottom: '.4rem' }}>Contents</div>
            {TOC.map(([n, label]) => (
              <div key={n}>
                <a href={`#s${n}`} style={S.tocLink}>{n}. {label}</a>
              </div>
            ))}
          </nav>

          <h2 style={S.h2} id="s1">1. Who we are and how this policy applies</h2>
          <p style={S.p}>
            BriefBridge (“<span style={S.strong}>BriefBridge</span>”, “we”,
            “us”, “our”) operates the BriefBridge platform at briefbridge.ai
            (the “<span style={S.strong}>Platform</span>”) — an AI-assisted
            legal research and matter workspace for Australian legal
            practitioners. This policy applies to all personal information we
            handle in connection with the Platform, our website, and our
            communications with you. It applies whether you use an individual
            account or a firm workspace. Where you use the Platform through a
            firm, your firm may have its own privacy obligations to its
            clients; this policy governs our handling, not theirs.
          </p>

          <h2 style={S.h2} id="s2">2. Definitions</h2>
          <ul>
            <li style={S.li}><span style={S.strong}>Personal information</span> — information or an opinion about an identified or reasonably identifiable individual, as defined in the Privacy Act.</li>
            <li style={S.li}><span style={S.strong}>Your Content</span> — the matters, documents, files, research questions, conversations, notes and other material you upload to or create on the Platform. Your Content may include personal information about you and about third parties (for example, parties to a matter), and may be confidential or privileged.</li>
            <li style={S.li}><span style={S.strong}>Usage Data</span> — technical and event information generated by your use of the Platform (described in §4).</li>
            <li style={S.li}><span style={S.strong}>Service Providers</span> — the third-party infrastructure providers listed in §7 that we use to operate the Platform.</li>
          </ul>

          <h2 style={S.h2} id="s3">3. Our commitments at a glance</h2>
          <div style={S.callout}>
            <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
              <li style={S.li}>We <span style={S.strong}>never use Your Content to train AI models</span> — ours or anyone else's.</li>
              <li style={S.li}>We <span style={S.strong}>never sell</span> personal information or Your Content, and never share it with advertisers or data brokers.</li>
              <li style={S.li}>Our internal analytics record <span style={S.strong}>event metadata only</span> — never the text of your questions, documents or conversations.</li>
              <li style={S.li}>Access to Your Content by our personnel is <span style={S.strong}>restricted, minimised and logged</span>, and occurs only in the limited circumstances in §6.</li>
              <li style={S.li}>You can <span style={S.strong}>delete Your Content at any time</span>, and request full account deletion (§10).</li>
            </ul>
          </div>

          <h2 style={S.h2} id="s4">4. Information we collect</h2>
          <h3 style={S.h3}>4.1 Account information</h3>
          <p style={S.p}>
            Name, email address, password hash (never your plaintext
            password), and — if you sign in with Google — your name, email
            and Google profile identifier as provided by Google. If you join
            or create a firm workspace: your firm name and role within it.
          </p>
          <h3 style={S.h3}>4.2 Your Content</h3>
          <p style={S.p}>
            The matters you create, documents and files you upload, research
            questions you ask, AI conversations you conduct, and notes you
            keep. <span style={S.strong}>You control what you put into the
            Platform.</span> Your Content may include third-party personal
            information (for example, names of parties, witnesses or
            practitioners in matter documents); you are responsible for
            ensuring you are entitled to handle that information, and we
            handle it strictly as your service provider under this policy.
          </p>
          <h3 style={S.h3}>4.3 Usage Data</h3>
          <p style={S.p}>
            Event records such as: feature used, timestamps, counts of
            sources retrieved, retrieval quality scores, session and device
            information (browser type, operating system, approximate region
            derived from IP), and error logs. Usage Data is engineered to
            exclude the substantive content of your research: our analytics
            events record, for example, <em>that</em> a research query was
            run and <em>how many</em> sources it returned — never the text of
            the query or the response.
          </p>
          <h3 style={S.h3}>4.4 Billing information</h3>
          <p style={S.p}>
            If you purchase a subscription, payment is processed by our
            payment provider. We receive and store your plan, billing
            status, and partial card details (such as last four digits and
            expiry) for account management. <span style={S.strong}>We never
            store full card numbers.</span>
          </p>
          <h3 style={S.h3}>4.5 Communications</h3>
          <p style={S.p}>
            Support requests, feedback, and correspondence you send us,
            including the contact details you use to send them.
          </p>

          <h2 style={S.h2} id="s5">5. How we use your information</h2>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Purpose</th>
                <th style={S.th}>Information used</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style={S.td}>Providing the Platform: running your searches, generating research responses, storing matters and files, operating firm workspaces</td><td style={S.td}>Account information; Your Content</td></tr>
              <tr><td style={S.td}>Securing the Platform: authentication, abuse and fraud prevention, incident investigation</td><td style={S.td}>Account information; Usage Data</td></tr>
              <tr><td style={S.td}>Operating and improving the product: aggregate feature usage, retrieval quality measurement, error diagnosis</td><td style={S.td}>Usage Data (metadata only — never the content of queries or documents)</td></tr>
              <tr><td style={S.td}>Billing and account management</td><td style={S.td}>Account information; billing information</td></tr>
              <tr><td style={S.td}>Communicating with you: service notices, security alerts, support responses; product updates only with your consent</td><td style={S.td}>Account information; communications</td></tr>
              <tr><td style={S.td}>Complying with law: responding to lawful requests, meeting record-keeping obligations</td><td style={S.td}>The minimum necessary for the obligation</td></tr>
            </tbody>
          </table>
          <p style={S.p}>
            We do not use your information for any purpose not listed above
            without telling you first. In particular:{' '}
            <span style={S.strong}>we do not use Your Content to train,
            fine-tune or evaluate AI models; we do not sell personal
            information; and we do not share Your Content with other users
            except within a firm workspace you have expressly joined and only
            for matters you or your colleagues have shared.</span>
          </p>

          <h2 style={S.h2} id="s6">6. Confidentiality and legal professional privilege</h2>
          <p style={S.p}>
            The Platform is designed as a confidential working tool, and we
            treat Your Content as confidential information — not merely as
            personal information. Specifically:
          </p>
          <ul>
            <li style={S.li}><span style={S.strong}>Access isolation.</span> Your Content is accessible only to your account and, where you use firm features, to colleagues with whom a matter is expressly shared. Access controls are enforced at the database layer (row-level security), not just in application code.</li>
            <li style={S.li}><span style={S.strong}>Personnel access.</span> Our personnel do not view Your Content except: (a) where strictly necessary to provide support you have requested; (b) to investigate suspected abuse, fraud or a security incident; or (c) where required by law. Any such access is limited to the minimum necessary and is logged.</li>
            <li style={S.li}><span style={S.strong}>Privilege.</span> Nothing about the Platform is intended to affect the confidential or privileged status of your material. Our systems and contracts with Service Providers are structured to maintain confidentiality. You remain responsible for your own professional obligations, including judgements about what material is appropriate to process through any third-party tool, and for compliance with any court orders (including suppression and non-publication orders) applying to material in your possession.</li>
            <li style={S.li}><span style={S.strong}>Legal demands.</span> If we receive a subpoena, warrant or other compulsory process seeking Your Content, we will — unless legally prohibited — notify you promptly so that you may raise any claim of privilege or objection before we respond, and we will disclose only what we are legally compelled to disclose.</li>
          </ul>

          <h2 style={S.h2} id="s7">7. Who we share information with (service providers)</h2>
          <p style={S.p}>
            We use a small number of infrastructure providers to operate the
            Platform. Each receives only the information necessary to perform
            its function, under contractual terms consistent with this
            policy:
          </p>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Provider</th>
                <th style={S.th}>Function</th>
                <th style={S.th}>Location of processing</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style={S.td}>Supabase</td><td style={S.td}>Database and authentication hosting — the primary store for account information and Your Content</td><td style={S.td}>Singapore (AWS ap-southeast-1)</td></tr>
              <tr><td style={S.td}>Vercel</td><td style={S.td}>Application hosting and content delivery</td><td style={S.td}>Global edge network; compute primarily US/AP regions</td></tr>
              <tr><td style={S.td}>Anthropic</td><td style={S.td}>AI model provider — processes your research questions and relevant retrieved material to generate responses. API inputs/outputs are not used by Anthropic to train models</td><td style={S.td}>United States</td></tr>
              <tr><td style={S.td}>Voyage AI</td><td style={S.td}>Embedding provider — processes query text to enable semantic search. API data is not used for model training</td><td style={S.td}>United States</td></tr>
              <tr><td style={S.td}>Resend</td><td style={S.td}>Transactional email (account, invitation and security emails)</td><td style={S.td}>United States</td></tr>
              <tr><td style={S.td}>Google</td><td style={S.td}>Sign-in (only if you choose Google authentication)</td><td style={S.td}>Global</td></tr>
            </tbody>
          </table>
          <p style={S.p}>
            We may also disclose information: where required by law, court
            order or compulsory process (subject to §6); to our professional
            advisers under confidentiality; or as part of a bona fide sale or
            restructure of our business, in which case the recipient will be
            bound by this policy and you will be notified. We do not disclose
            personal information to any other third parties.
          </p>

          <h2 style={S.h2} id="s8">8. Where your information is stored and processed</h2>
          <p style={S.p}>
            Our primary database is hosted with Supabase in{' '}
            <span style={S.strong}>Singapore (AWS ap-southeast-1)</span>. AI
            processing occurs in the <span style={S.strong}>United
            States</span> (Anthropic and Voyage AI), and application hosting
            (Vercel) may process requests in multiple regions. This is
            cross-border disclosure for the purposes of APP 8, and by using
            the Platform you consent to it. We choose providers with strong,
            audited security practices and contractual protections consistent
            with the APPs. We are working towards Australian-region data
            hosting; this policy will be updated when that changes.
          </p>

          <h2 style={S.h2} id="s9">9. How we protect your information</h2>
          <ul>
            <li style={S.li}><span style={S.strong}>Encryption</span> — TLS for all data in transit; encryption at rest for stored data and backups.</li>
            <li style={S.li}><span style={S.strong}>Row-level security</span> — database-enforced access isolation between accounts and firms, so a request can only ever reach the rows it is entitled to.</li>
            <li style={S.li}><span style={S.strong}>Least-privilege architecture</span> — the application operates under a restricted database role; administrative credentials are separated, and privileged operations are confined to controlled tooling.</li>
            <li style={S.li}><span style={S.strong}>Authentication</span> — passwords are hashed (never stored in plaintext); OAuth sign-in is supported; sessions are managed with industry-standard tokens.</li>
            <li style={S.li}><span style={S.strong}>Content-free analytics</span> — internal analytics are structurally incapable of capturing your research content, because only event metadata is transmitted to them.</li>
            <li style={S.li}><span style={S.strong}>Provider security</span> — our Service Providers maintain independent security programs and certifications (e.g. SOC 2-audited infrastructure).</li>
          </ul>
          <p style={S.p}>
            No system is perfectly secure, and we do not promise that
            security incidents can never occur — but we design so that the
            impact of any single failure is contained, and we respond as set
            out in §14.
          </p>

          <h2 style={S.h2} id="s10">10. Data retention and deletion</h2>
          <ul>
            <li style={S.li}><span style={S.strong}>Your Content</span> — retained while your account is active. You can delete matters, files and conversations at any time within the Platform; deletion removes the content from live systems promptly and from backups in the ordinary backup rotation cycle.</li>
            <li style={S.li}><span style={S.strong}>Account deletion</span> — you may request deletion of your entire account and its content at any time (§18). We action account deletion within 30 days, subject to any legal retention obligations, and confirm when complete.</li>
            <li style={S.li}><span style={S.strong}>Usage Data</span> — retained in identifiable form only as long as needed for the purposes in §5, then deleted or aggregated.</li>
            <li style={S.li}><span style={S.strong}>Billing records</span> — retained as required by Australian tax and corporations law (generally 7 years).</li>
          </ul>

          <h2 style={S.h2} id="s11">11. Cookies and website analytics</h2>
          <p style={S.p}>
            The Platform uses strictly necessary cookies for authentication
            and session management. We do not use third-party advertising
            cookies or cross-site tracking. Any website analytics we operate
            are first-party and measure aggregate page usage only.
          </p>

          <h2 style={S.h2} id="s12">12. Direct marketing</h2>
          <p style={S.p}>
            We send product and feature communications only where you have
            opted in or would reasonably expect them, and every such message
            contains a working unsubscribe. We never use Your Content for
            marketing, never disclose your details to third-party marketers,
            and honour opt-outs immediately (APP 7).
          </p>

          <h2 style={S.h2} id="s13">13. Anonymity and pseudonymity</h2>
          <p style={S.p}>
            You may browse our public pages without identifying yourself.
            Because the Platform stores confidential working material against
            authenticated accounts, we cannot provide the logged-in service
            anonymously — identification is required to secure your data to
            you (APP 2).
          </p>

          <h2 style={S.h2} id="s14">14. Data breach response</h2>
          <p style={S.p}>
            If a data breach occurs that is likely to result in serious harm
            to any individual, we will: contain and investigate the incident;
            notify affected users promptly with a description of the breach,
            the information involved, and the steps we recommend; and notify
            the Office of the Australian Information Commissioner, all in
            accordance with the Notifiable Data Breaches scheme. Given the
            professional sensitivity of Your Content, our notification to you
            will be specific enough for you to assess any obligations you may
            have to your own clients.
          </p>

          <h2 style={S.h2} id="s15">15. Your rights: access, correction and complaints</h2>
          <ul>
            <li style={S.li}><span style={S.strong}>Access</span> — you may request a copy of the personal information we hold about you. We respond within 30 days.</li>
            <li style={S.li}><span style={S.strong}>Correction</span> — you may ask us to correct inaccurate information; most account information can be corrected directly in the Platform.</li>
            <li style={S.li}><span style={S.strong}>Export</span> — you can export Your Content from the Platform, and may request an export as part of account closure.</li>
            <li style={S.li}><span style={S.strong}>Complaints</span> — contact us first (§18); we acknowledge complaints within 7 days and aim to resolve them within 30. If you are not satisfied, you may complain to the Office of the Australian Information Commissioner: oaic.gov.au, 1300 363 992, GPO Box 5288 Sydney NSW 2001.</li>
          </ul>

          <h2 style={S.h2} id="s16">16. Users outside Australia</h2>
          <p style={S.p}>
            The Platform is designed for Australian legal practice. If you
            access it from outside Australia, you do so on the basis that
            your information will be handled in accordance with this policy
            and Australian law. Where overseas privacy laws grant you
            additional rights, we will honour reasonable requests to exercise
            them.
          </p>

          <h2 style={S.h2} id="s17">17. Changes to this policy</h2>
          <p style={S.p}>
            We may update this policy from time to time. Material changes
            will be notified in the Platform or by email before they take
            effect. The “last updated” date at the top reflects the current
            version, and prior versions are available on request.
          </p>

          <h2 style={S.h2} id="s18">18. Contact us</h2>
          <p style={S.p}>
            Privacy questions, access or correction requests, deletion
            requests, and complaints:{' '}
            <a href="mailto:privacy@briefbridge.com.au" style={{ color: NAVY }}>privacy@briefbridge.com.au</a>.
          </p>

          <p style={{ ...S.p, marginTop: '2.5rem', fontSize: '.85rem', color: MUTED }}>
            See also our <Link href="/terms" style={{ color: NAVY }}>Terms of Service</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}