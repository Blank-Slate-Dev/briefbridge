// app/legislation/[jurisdiction]/[act]/s/[section]/page.tsx
//
// Public legislation SECTION page — the core programmatic SEO unit.
//
// Answer-first structure (per SEO playbook): H1 names the section, the
// opening block IS the in-force text (the answer), followed by attribution
// (CC BY compliance), related-section internal links, and a product CTA.
//
// Indexation tier: only PRIORITY_ACT_SLUGS are index; all other acts render
// but carry noindex until enriched (thin-page protection).
//
// Rendering: ISR (revalidate daily) — pages update when the corpus updates
// without rebuilding tens of thousands of routes.

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getActBySlug,
  getSection,
  getNeighbourSections,
  isPriorityAct,
  dbJurisdictionToUrl,
} from '@/lib/legislation/public-pages';

export const revalidate = 86400; // 24h ISR

interface Params {
  jurisdiction: string;
  act: string;
  section: string;
}

const NAVY = '#1a1f2e';
const SOFT = '#3a4256';
const MUTED = '#8a8577';
const GOLD = '#c9a24b';
const BORDER = '#e7e0d2';

function jurisdictionLabel(dbJurisdiction: string): string {
  return dbJurisdiction === 'commonwealth' ? 'Cth' : 'NSW';
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { jurisdiction, act, section } = await params;
  const actRow = await getActBySlug(jurisdiction, act);
  if (!actRow) return {};
  const sectionRow = await getSection(actRow.id, section);
  if (!sectionRow) return {};

  const label = jurisdictionLabel(actRow.jurisdiction);
  const title = `Section ${sectionRow.number} — ${actRow.shortTitle} (${label})`;
  const headingPart = sectionRow.heading ? `${sectionRow.heading}. ` : '';
  const description =
    `${headingPart}The current in-force text of s ${sectionRow.number} of the ` +
    `${actRow.shortTitle} (${label}), with related sections and research tools.`;

  const path = `/legislation/${jurisdiction}/${act}/s/${section.toLowerCase()}`;

  return {
    title,
    description,
    alternates: { canonical: path },
    robots: isPriorityAct(actRow.slug)
      ? { index: true, follow: true }
      : { index: false, follow: true },
  };
}

export default async function SectionPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { jurisdiction, act, section } = await params;
  const actRow = await getActBySlug(jurisdiction, act);
  if (!actRow) notFound();
  const sectionRow = await getSection(actRow.id, section);
  if (!sectionRow) notFound();

  const neighbours = await getNeighbourSections(actRow.id, sectionRow.number);
  const label = jurisdictionLabel(actRow.jurisdiction);
  const urlJ = dbJurisdictionToUrl(actRow.jurisdiction);

  // schema.org Legislation JSON-LD (ELI-derived vocabulary — the correct
  // type for statute sections).
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Legislation',
    name: `${actRow.shortTitle} (${label}) s ${sectionRow.number}`,
    legislationIdentifier:
      sectionRow.citation ?? `${actRow.shortTitle} s ${sectionRow.number}`,
    legislationType: 'Act',
    inLanguage: 'en-AU',
    isPartOf: {
      '@type': 'Legislation',
      name: actRow.shortTitle,
      legislationIdentifier: actRow.citation ?? actRow.shortTitle,
    },
  };

  return (
    <div style={{ background: '#f4efe6', minHeight: '100vh', padding: '2.5rem 1.25rem', color: SOFT }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        {/* Breadcrumb */}
        <nav style={{ fontSize: '.85rem', marginBottom: '1.25rem', color: MUTED }} aria-label="Breadcrumb">
          <Link href="/legislation" style={{ color: MUTED }}>Legislation</Link>
          {' › '}
          <Link href={`/legislation/${urlJ}/${actRow.slug}`} style={{ color: MUTED }}>
            {actRow.shortTitle} ({label})
          </Link>
          {' › '}
          <span style={{ color: NAVY }}>s {sectionRow.number}</span>
        </nav>

        {/* H1 + heading */}
        <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.75rem', color: NAVY, lineHeight: 1.25, marginBottom: '.35rem' }}>
          Section {sectionRow.number} — {actRow.shortTitle} ({label})
        </h1>
        {sectionRow.heading && (
          <p style={{ fontSize: '1.05rem', color: SOFT, fontStyle: 'italic', marginBottom: '1.5rem' }}>
            {sectionRow.heading}
          </p>
        )}

        {/* The in-force text — the answer, first */}
        <section
          style={{
            background: '#fff',
            border: `1px solid ${BORDER}`,
            borderTop: `4px solid ${GOLD}`,
            borderRadius: 12,
            padding: '1.75rem 2rem',
            marginBottom: '1.25rem',
          }}
        >
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              fontFamily: 'inherit',
              fontSize: '.95rem',
              lineHeight: 1.7,
              margin: 0,
              color: SOFT,
            }}
          >
            {sectionRow.text}
          </pre>
        </section>

        {/* Attribution — CC BY compliance */}
        <p style={{ fontSize: '.75rem', color: MUTED, lineHeight: 1.5, marginBottom: '2rem' }}>
          {actRow.attributionText ??
            `Sourced from official ${label === 'NSW' ? 'New South Wales' : 'Commonwealth'} legislation, licensed under Creative Commons Attribution 4.0 (CC BY 4.0).`}{' '}
          Verify the current text against the official source before relying on it.
        </p>

        {/* Related sections — internal linking */}
        {neighbours.length > 0 && (
          <section style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', color: NAVY, marginBottom: '.6rem' }}>
              Related sections
            </h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {neighbours.map((n) => (
                <li key={n.number} style={{ margin: '.3rem 0', fontSize: '.9rem' }}>
                  <Link
                    href={`/legislation/${urlJ}/${actRow.slug}/s/${n.urlNumber}`}
                    style={{ color: NAVY }}
                  >
                    s {n.number}
                    {n.heading ? ` — ${n.heading}` : ''}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Product CTA */}
        <section
          style={{
            background: NAVY,
            borderRadius: 12,
            padding: '1.5rem 2rem',
            color: '#f4efe6',
          }}
        >
          <h2 style={{ fontFamily: 'Georgia, serif', fontSize: '1.15rem', margin: '0 0 .4rem', color: '#f4efe6' }}>
            Research how courts apply s {sectionRow.number}
          </h2>
          <p style={{ fontSize: '.9rem', lineHeight: 1.6, margin: '0 0 1rem', color: '#d8d3c4' }}>
            BriefBridge searches {label === 'NSW' ? 'NSW and High Court' : 'Australian'} caselaw by meaning —
            every answer cited to the paragraph.
          </p>
          <Link
            href="/login"
            style={{
              display: 'inline-block',
              background: GOLD,
              color: NAVY,
              padding: '.6rem 1.4rem',
              borderRadius: 8,
              fontWeight: 600,
              fontSize: '.9rem',
              textDecoration: 'none',
            }}
          >
            Try BriefBridge free
          </Link>
        </section>
      </div>
    </div>
  );
}