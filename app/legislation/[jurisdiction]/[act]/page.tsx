// app/legislation/[jurisdiction]/[act]/page.tsx
//
// Public Act TABLE-OF-CONTENTS page — lists every page-worthy section of an
// Act with links to the section pages. The internal-linking hub that makes
// section pages discoverable and crawlable within 3 clicks of the homepage.
//
// Same indexation tier as section pages: priority acts index, rest noindex.

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getActBySlug,
  listActSections,
  isPriorityAct,
  dbJurisdictionToUrl,
} from '@/lib/legislation/public-pages';

export const revalidate = 86400;

interface Params {
  jurisdiction: string;
  act: string;
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
  const { jurisdiction, act } = await params;
  const actRow = await getActBySlug(jurisdiction, act);
  if (!actRow) return {};
  const label = jurisdictionLabel(actRow.jurisdiction);
  return {
    title: `${actRow.shortTitle} (${label}) — sections and text`,
    description: `Browse the current in-force sections of the ${actRow.shortTitle} (${label}) with full text, related provisions and research tools.`,
    alternates: { canonical: `/legislation/${jurisdiction}/${act}` },
    robots: isPriorityAct(actRow.slug)
      ? { index: true, follow: true }
      : { index: false, follow: true },
  };
}

export default async function ActPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { jurisdiction, act } = await params;
  const actRow = await getActBySlug(jurisdiction, act);
  if (!actRow) notFound();

  const sections = await listActSections(actRow.id);
  const label = jurisdictionLabel(actRow.jurisdiction);
  const urlJ = dbJurisdictionToUrl(actRow.jurisdiction);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Legislation',
    name: `${actRow.shortTitle} (${label})`,
    legislationIdentifier: actRow.citation ?? actRow.shortTitle,
    legislationType: 'Act',
    inLanguage: 'en-AU',
  };

  return (
    <div style={{ background: '#f4efe6', minHeight: '100vh', padding: '2.5rem 1.25rem', color: SOFT }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <nav style={{ fontSize: '.85rem', marginBottom: '1.25rem', color: MUTED }} aria-label="Breadcrumb">
          <Link href="/legislation" style={{ color: MUTED }}>Legislation</Link>
          {' › '}
          <span style={{ color: NAVY }}>{actRow.shortTitle} ({label})</span>
        </nav>

        <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.9rem', color: NAVY, lineHeight: 1.25, marginBottom: '.35rem' }}>
          {actRow.shortTitle} ({label})
        </h1>
        {actRow.longTitle && (
          <p style={{ fontSize: '.95rem', color: MUTED, fontStyle: 'italic', marginBottom: '1.75rem', lineHeight: 1.5 }}>
            {actRow.longTitle}
          </p>
        )}

        <section
          style={{
            background: '#fff',
            border: `1px solid ${BORDER}`,
            borderTop: `4px solid ${GOLD}`,
            borderRadius: 12,
            padding: '1.5rem 2rem',
            marginBottom: '1.5rem',
          }}
        >
          <h2 style={{ fontFamily: 'Georgia, serif', fontSize: '1.15rem', color: NAVY, margin: '0 0 .9rem' }}>
            Sections ({sections.length})
          </h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, columnCount: sections.length > 40 ? 2 : 1, columnGap: '2rem' }}>
            {sections.map((s) => (
              <li key={s.number} style={{ margin: '.28rem 0', fontSize: '.88rem', breakInside: 'avoid' }}>
                <Link
                  href={`/legislation/${urlJ}/${actRow.slug}/s/${s.urlNumber}`}
                  style={{ color: NAVY, textDecoration: 'none' }}
                >
                  <span style={{ color: GOLD, fontWeight: 600 }}>s {s.number}</span>
                  {s.heading ? <span style={{ color: SOFT }}> — {s.heading}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <p style={{ fontSize: '.75rem', color: MUTED, lineHeight: 1.5 }}>
          {actRow.attributionText ??
            `Sourced from official ${label === 'NSW' ? 'New South Wales' : 'Commonwealth'} legislation, licensed under Creative Commons Attribution 4.0 (CC BY 4.0).`}
        </p>
      </div>
    </div>
  );
}