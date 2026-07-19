// app/legislation/page.tsx
//
// Public legislation INDEX — the landing hub at /legislation.
//
// V1 scope: lists the PRIORITY acts (the index-tier set), grouped by
// jurisdiction. Deliberately curated rather than dumping all 2,000+ acts —
// this page's job is (a) crawl path to the priority sections within 2
// clicks, (b) a clean landing target for "browse legislation" intent.
// The full corpus remains reachable via direct URL (noindex until enriched).

import type { Metadata } from 'next';
import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  PRIORITY_ACT_SLUGS,
  slugifyAct,
  dbJurisdictionToUrl,
} from '@/lib/legislation/public-pages';

export const revalidate = 86400;

export const metadata: Metadata = {
  title: 'Australian Legislation — browse Acts and sections',
  description:
    'Browse the current in-force text of key NSW and Commonwealth legislation, section by section, with related provisions and caselaw research tools.',
  alternates: { canonical: '/legislation' },
  robots: { index: true, follow: true },
};

const NAVY = '#1a1f2e';
const SOFT = '#3a4256';
const MUTED = '#8a8577';
const GOLD = '#c9a24b';
const BORDER = '#e7e0d2';

type ActRow = {
  short_title: string;
  jurisdiction: string;
} & Record<string, unknown>;

export default async function LegislationIndexPage() {
  // Fetch all in-force acts, filter to the priority set in JS (the slug is
  // derived, so matching in SQL would duplicate the slugify logic).
  const rows = await db.execute<ActRow>(sql`
    SELECT short_title, jurisdiction
    FROM legislation
    WHERE in_force = true
    ORDER BY short_title ASC
  `);

  const priority = rows
    .map((r) => ({
      shortTitle: r.short_title,
      jurisdiction: r.jurisdiction,
      slug: slugifyAct(r.short_title),
    }))
    .filter((r) => PRIORITY_ACT_SLUGS.has(r.slug));

  const nsw = priority.filter((r) => r.jurisdiction === 'nsw');
  const cth = priority.filter((r) => r.jurisdiction === 'commonwealth');

  return (
    <div style={{ background: '#f4efe6', minHeight: '100vh', padding: '2.5rem 1.25rem', color: SOFT }}>
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.9rem', color: NAVY, lineHeight: 1.25, marginBottom: '.4rem' }}>
          Australian Legislation
        </h1>
        <p style={{ fontSize: '.95rem', color: MUTED, marginBottom: '2rem', lineHeight: 1.6 }}>
          Current in-force text, section by section. Sourced from official
          government publications under CC BY 4.0.
        </p>

        {[
          { label: 'New South Wales', acts: nsw, urlJ: 'nsw' },
          { label: 'Commonwealth', acts: cth, urlJ: 'cth' },
        ].map(({ label, acts, urlJ }) => (
          <section
            key={label}
            style={{
              background: '#fff',
              border: `1px solid ${BORDER}`,
              borderTop: `4px solid ${GOLD}`,
              borderRadius: 12,
              padding: '1.5rem 2rem',
              marginBottom: '1.5rem',
            }}
          >
            <h2 style={{ fontFamily: 'Georgia, serif', fontSize: '1.2rem', color: NAVY, margin: '0 0 .9rem' }}>
              {label}
            </h2>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {acts.map((a) => (
                <li key={a.slug} style={{ margin: '.35rem 0', fontSize: '.92rem' }}>
                  <Link
                    href={`/legislation/${dbJurisdictionToUrl(a.jurisdiction)}/${a.slug}`}
                    style={{ color: NAVY }}
                  >
                    {a.shortTitle}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <p style={{ fontSize: '.8rem', color: MUTED, lineHeight: 1.6 }}>
          Looking for a section we haven't listed? BriefBridge's research
          platform covers all in-force NSW and Commonwealth Acts.{' '}
          <Link href="/login" style={{ color: NAVY, fontWeight: 600 }}>
            Try it free
          </Link>
          .
        </p>
      </div>
    </div>
  );
}