// app/terms/page.tsx
//
// Terms of Service — public page, no auth. Self-contained styling.
//
// ⚠ DRAFT FOR REVIEW: modelled on comparable Australian AI-for-professionals
// terms, adapted for legal research. Have an Australian lawyer review before
// commercial reliance. Key protections: no-legal-advice, verification
// obligation, confidentiality commitments, ACL-compliant liability caps.

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service — BriefBridge',
  description: 'The terms that govern your use of BriefBridge.',
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
  callout: { background: '#faf6ec', border: `1px solid ${GOLD}`, borderRadius: 10, padding: '1rem 1.25rem', fontSize: '.95rem', lineHeight: 1.7, margin: '1rem 0' } as const,
};

export default function TermsPage() {
  return (
    <div style={S.page}>
      <div style={S.card}>
        <h1 style={S.h1}>Terms of Service</h1>
        <p style={S.meta}>BriefBridge — briefbridge.ai · Last updated: 14 July 2026</p>

        <p style={S.p}>
          These terms govern your access to and use of the BriefBridge
          platform at briefbridge.ai (the <strong style={{ color: NAVY }}>Platform</strong>),
          operated by BriefBridge (<strong style={{ color: NAVY }}>we, us, our</strong>). By
          creating an account or using the Platform you agree to these terms.
          If you do not agree, do not use the Platform.
        </p>

        <h2 style={S.h2}>1. The service</h2>
        <p style={S.p}>
          The Platform provides AI-assisted legal research over a corpus of
          Australian court judgments and legislation, together with matter and
          document workspace features, for use by legal practitioners and
          others conducting legal research. Court judgments and legislation
          are reproduced from public sources; legislative material is used
          under applicable government licensing and remains subject to its
          own terms.
        </p>

        <div style={S.callout}>
          <strong style={{ color: NAVY }}>The Platform is a research tool — not a lawyer, and not
          legal advice.</strong> Outputs are generated with the assistance of AI and
          may contain errors, omissions, or out-of-date statements of law.
          You must verify every authority, citation and proposition against
          official sources before relying on it, and you remain solely
          responsible for any professional work product, advice, court
          document or decision you produce. Nothing in the Platform creates a
          solicitor–client relationship with us.
        </div>

        <h2 style={S.h2}>2. Accounts</h2>
        <ul>
          <li style={S.li}>You must provide accurate registration information and keep your credentials secure. You are responsible for activity under your account.</li>
          <li style={S.li}>You must be at least 18 and able to enter a binding agreement.</li>
          <li style={S.li}>If you use the Platform within a firm workspace, you must have authority to do so, and you are responsible for complying with your firm's policies.</li>
        </ul>

        <h2 style={S.h2}>3. Your content</h2>
        <p style={S.p}>
          You retain all rights in the content you upload or create on the
          Platform (matters, documents, questions, notes — <strong style={{ color: NAVY }}>Your
          Content</strong>). You grant us a limited licence to host, process and
          display Your Content solely to provide the service to you. We do not
          use Your Content to train AI models, and we do not sell it or share
          it except with the infrastructure providers necessary to run the
          service, as described in our Privacy Policy.
        </p>
        <p style={S.p}>
          You are responsible for ensuring you are entitled to upload the
          material you upload, including compliance with your obligations of
          confidentiality and any court orders (for example, suppression or
          non-publication orders) applying to material in your possession.
        </p>

        <h2 style={S.h2}>4. Confidentiality</h2>
        <p style={S.p}>
          We treat Your Content as confidential. We will not access it except
          as strictly necessary to provide the service, respond to support
          requests you make, investigate abuse or security incidents, or as
          required by law. This clause is intended to support — not replace —
          your own professional duties of confidentiality and any claims of
          legal professional privilege over your material.
        </p>

        <h2 style={S.h2}>5. Acceptable use</h2>
        <p style={S.p}>You must not:</p>
        <ul>
          <li style={S.li}>use the Platform in breach of law, professional conduct rules, or court orders;</li>
          <li style={S.li}>attempt to gain unauthorised access to the Platform, other users' data, or our infrastructure;</li>
          <li style={S.li}>scrape, bulk-export or resell the research corpus or Platform outputs as a competing database or service;</li>
          <li style={S.li}>use the Platform to generate content you present as issued by a court, or misrepresent AI-generated material as an official source.</li>
        </ul>

        <h2 style={S.h2}>6. Fees</h2>
        <p style={S.p}>
          Paid plans are billed as described at purchase. Fees are in
          Australian dollars and inclusive of GST unless stated otherwise. We
          may change pricing on notice; changes apply from your next billing
          cycle. You may cancel at any time, effective at the end of the
          current billing period.
        </p>

        <h2 style={S.h2}>7. Intellectual property</h2>
        <p style={S.p}>
          We (and our licensors) own the Platform, including its software,
          design, and the compilation and enrichment of the research corpus.
          Underlying judgments and legislation remain subject to their public
          licensing. These terms do not transfer any of our intellectual
          property to you beyond the right to use the Platform.
        </p>

        <h2 style={S.h2}>8. Availability and changes</h2>
        <p style={S.p}>
          We aim for high availability but do not guarantee the Platform will
          be uninterrupted or error-free. We may modify features, and may
          suspend or terminate accounts that breach these terms (with notice
          where practicable). You may export or delete Your Content at any
          time before account closure.
        </p>

        <h2 style={S.h2}>9. Liability</h2>
        <p style={S.p}>
          Nothing in these terms excludes, restricts or modifies any consumer
          guarantee or right under the Australian Consumer Law or other law
          that cannot lawfully be excluded. Subject to that:
        </p>
        <ul>
          <li style={S.li}>the Platform is provided “as is”, and we exclude all other warranties;</li>
          <li style={S.li}>we are not liable for loss arising from reliance on Platform outputs without verification, or from your professional work product;</li>
          <li style={S.li}>we are not liable for indirect or consequential loss; and</li>
          <li style={S.li}>our total aggregate liability is limited to the amount you paid us in the 12 months before the claim (or, where liability cannot be so limited, to re-supplying the service).</li>
        </ul>
        <p style={S.p}>
          You indemnify us against claims arising from your breach of these
          terms or your professional use of Platform outputs, except to the
          extent we caused the loss.
        </p>

        <h2 style={S.h2}>10. General</h2>
        <p style={S.p}>
          These terms are governed by the laws of New South Wales, Australia,
          and the parties submit to the jurisdiction of its courts. We may
          update these terms; material changes will be notified in the
          Platform or by email, and continued use after notice constitutes
          acceptance. If any provision is unenforceable, the remainder
          continues in effect. Questions:{' '}
          <a href="mailto:legal@briefbridge.com.au" style={{ color: NAVY }}>legal@briefbridge.com.au</a>.
        </p>
      </div>
    </div>
  );
}