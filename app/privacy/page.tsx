// app/privacy/page.tsx
//
// Privacy Policy — public page, no auth. Self-contained styling (navy on
// cream) consistent with the brand.
//
// ⚠ DRAFT FOR REVIEW: this was prepared as a working draft modelled on
// comparable Australian AI-for-professionals policies. Have it reviewed by
// an Australian lawyer before relying on it commercially. It is written to
// be ACCURATE for the current architecture (Supabase Singapore, Anthropic/
// Voyage US processing) — if infrastructure changes (e.g. migration to an
// Australian region), update sections 6 and 7.

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — BriefBridge',
  description: 'How BriefBridge collects, uses, stores and protects your information.',
};

const NAVY = '#1a1f2e';
const SOFT = '#3a4256';
const MUTED = '#8a8577';
const GOLD = '#c9a24b';

const S = {
  page: { background: '#f4efe6', minHeight: '100vh', padding: '3rem 1.5rem', color: SOFT } as const,
  card: { maxWidth: 760, margin: '0 auto', background: '#fff', border: '1px solid #e7e0d2', borderRadius: 16, padding: '3rem' } as const,
  h1: { fontFamily: 'Georgia, serif', fontSize: '2rem', color: NAVY, marginBottom: '.25rem' } as const,
  h2: { fontFamily: 'Georgia, serif', fontSize: '1.25rem', color: NAVY, marginTop: '2.25rem', marginBottom: '.6rem', borderBottom: `2px solid ${GOLD}`, paddingBottom: '.35rem', display: 'inline-block' } as const,
  p: { fontSize: '.95rem', lineHeight: 1.7, margin: '.6rem 0' } as const,
  li: { fontSize: '.95rem', lineHeight: 1.7, margin: '.3rem 0' } as const,
  meta: { fontSize: '.85rem', color: MUTED, marginBottom: '2rem' } as const,
};

export default function PrivacyPage() {
  return (
    <div style={S.page}>
      <div style={S.card}>
        <h1 style={S.h1}>Privacy Policy</h1>
        <p style={S.meta}>BriefBridge — briefbridge.ai · Last updated: 14 July 2026</p>

        <p style={S.p}>
          BriefBridge is built for lawyers. We know the material you work with —
          client information, matter details, research strategy — is among the
          most sensitive information there is, and may be subject to duties of
          confidentiality and legal professional privilege. We treat it that
          way. This policy explains what we collect, how we use it, where it is
          processed, and the choices you have. We handle personal information
          in accordance with the Privacy Act 1988 (Cth) and the Australian
          Privacy Principles (APPs).
        </p>

        <h2 style={S.h2}>1. Who we are</h2>
        <p style={S.p}>
          BriefBridge (referred to as “we”, “us” or “our”) operates the
          BriefBridge platform at briefbridge.ai — an AI-assisted legal
          research and matter workspace for Australian legal practitioners.
          Questions, requests or complaints about privacy can be sent to{' '}
          <a href="mailto:privacy@briefbridge.com.au" style={{ color: NAVY }}>privacy@briefbridge.com.au</a>.
        </p>

        <h2 style={S.h2}>2. What we collect</h2>
        <p style={S.p}><strong style={{ color: NAVY }}>Account information.</strong> Your name, email address, and authentication details (if you sign in with Google, we receive your name, email and profile identifier from Google).</p>
        <p style={S.p}><strong style={{ color: NAVY }}>Matter and research content.</strong> The matters you create, documents you upload, research questions you ask, and the conversations you have with the platform. This content may include information that is confidential or privileged. You control what you put into the platform.</p>
        <p style={S.p}><strong style={{ color: NAVY }}>Usage information.</strong> Technical and usage data such as feature usage counts, query metadata (for example, the number of sources retrieved), timestamps, and device/browser information. Our internal usage analytics record event metadata only — they do not store the text of your research questions or documents.</p>
        <p style={S.p}><strong style={{ color: NAVY }}>Billing information.</strong> If you purchase a subscription, payment is handled by our payment provider; we do not store full card numbers.</p>

        <h2 style={S.h2}>3. How we use your information</h2>
        <ul>
          <li style={S.li}>To provide the platform: run your searches, generate research responses, store your matters and files, and maintain your account.</li>
          <li style={S.li}>To keep the platform secure, prevent abuse, and comply with our legal obligations.</li>
          <li style={S.li}>To understand aggregate usage and improve the product (using event metadata, not your content).</li>
          <li style={S.li}>To communicate with you about your account, service changes, and — only if you opt in — product updates. You can opt out of non-essential communications at any time.</li>
        </ul>
        <p style={S.p}>
          <strong style={{ color: NAVY }}>We do not use your research content or documents to train AI
          models.</strong> We do not sell your information. We do not share your
          content with other users or third parties except as needed to operate
          the service (section 5).
        </p>

        <h2 style={S.h2}>4. Confidentiality and legal professional privilege</h2>
        <p style={S.p}>
          The platform is designed as a confidential working tool. Your matter
          content is accessible only to your account (and, where you use firm
          features, to colleagues you have expressly shared a matter with).
          Our staff do not access your content except where strictly necessary
          to provide support you have requested, to investigate abuse or a
          security incident, or where required by law — and any such access is
          minimised and logged.
        </p>
        <p style={S.p}>
          Nothing about the platform is intended to affect the confidential or
          privileged status of your material. You remain responsible for your
          own professional obligations, including judgements about what
          material is appropriate to process through any third-party tool.
        </p>

        <h2 style={S.h2}>5. Who we share information with (service providers)</h2>
        <p style={S.p}>We use a small number of infrastructure providers to operate the platform. Each receives only what is necessary to perform its function:</p>
        <ul>
          <li style={S.li}><strong style={{ color: NAVY }}>Supabase</strong> — database and authentication hosting (our primary data store).</li>
          <li style={S.li}><strong style={{ color: NAVY }}>Vercel</strong> — application hosting and delivery.</li>
          <li style={S.li}><strong style={{ color: NAVY }}>Anthropic</strong> — AI model provider that processes your research questions and relevant retrieved material to generate responses. API inputs and outputs are not used by Anthropic to train its models.</li>
          <li style={S.li}><strong style={{ color: NAVY }}>Voyage AI</strong> — embedding provider that processes query text to enable semantic search. API data is not used for model training.</li>
          <li style={S.li}><strong style={{ color: NAVY }}>Resend</strong> — transactional email delivery (account and invitation emails).</li>
          <li style={S.li}><strong style={{ color: NAVY }}>Google</strong> — if you choose Google sign-in.</li>
        </ul>
        <p style={S.p}>We may also disclose information where required by law, court order, or to protect our legal rights — and if that ever affects your data, we will tell you unless we are legally prevented from doing so.</p>

        <h2 style={S.h2}>6. Where your information is stored and processed</h2>
        <p style={S.p}>
          Our primary database is hosted with Supabase in <strong style={{ color: NAVY }}>Singapore
          (AWS ap-southeast-1)</strong>. AI processing occurs in the{' '}
          <strong style={{ color: NAVY }}>United States</strong> (Anthropic and Voyage AI), and
          application hosting (Vercel) may process requests in multiple
          regions. By using the platform you consent to this cross-border
          handling under APP 8. We choose providers with strong security
          practices and contractual protections, and we are working towards
          Australian-region data hosting; this policy will be updated when
          that changes.
        </p>

        <h2 style={S.h2}>7. How we protect your information</h2>
        <ul>
          <li style={S.li}>Encryption in transit (TLS) for all traffic, and encryption at rest for stored data.</li>
          <li style={S.li}>Row-level security so accounts can only access their own data.</li>
          <li style={S.li}>Least-privilege access controls for our own systems and staff.</li>
          <li style={S.li}>No training of AI models on your content; analytics restricted to event metadata.</li>
        </ul>
        <p style={S.p}>No system is perfectly secure. If a data breach occurs that is likely to result in serious harm, we will notify you and the OAIC in accordance with the Notifiable Data Breaches scheme.</p>

        <h2 style={S.h2}>8. Retention and deletion</h2>
        <p style={S.p}>
          We retain your content while your account is active. You can delete
          matters, files and conversations at any time, and you can request
          deletion of your entire account and its content by contacting us —
          we will action account deletion requests within 30 days, subject to
          any legal retention obligations.
        </p>

        <h2 style={S.h2}>9. Your rights</h2>
        <p style={S.p}>
          You may request access to, or correction of, the personal
          information we hold about you at any time. Contact{' '}
          <a href="mailto:privacy@briefbridge.com.au" style={{ color: NAVY }}>privacy@briefbridge.com.au</a>.
          If you are not satisfied with our response to a privacy complaint,
          you may complain to the Office of the Australian Information
          Commissioner (oaic.gov.au).
        </p>

        <h2 style={S.h2}>10. Changes to this policy</h2>
        <p style={S.p}>
          We may update this policy from time to time. Material changes will
          be notified in the platform or by email. The “last updated” date at
          the top reflects the current version.
        </p>
      </div>
    </div>
  );
}