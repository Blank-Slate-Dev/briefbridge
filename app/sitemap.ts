// app/sitemap.ts
//
// Serves /sitemap.xml — static pages + the PRIORITY-TIER legislation pages.
//
// Scope: only priority acts and their sections are listed (the index tier).
// Non-priority pages are noindex and deliberately absent — a sitemap should
// only contain URLs we WANT indexed, and Discovered-vs-Indexed per segment
// is our quality signal in Search Console.
//
// Size: priority tier ≈ single-digit thousands of URLs — well under the
// 50,000-URL single-sitemap cap. When case pages ship (or the tier grows),
// convert to generateSitemaps() with segmented children.
//
// lastModified: omitted deliberately — we don't yet track per-section
// content-change dates, and a fake blanket date trains Google to distrust
// the signal.

import type { MetadataRoute } from 'next';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  PRIORITY_ACT_SLUGS,
  slugifyAct,
  sectionToUrl,
  dbJurisdictionToUrl,
} from '@/lib/legislation/public-pages';

const BASE = 'https://briefbridge.ai';

interface ActRow {
  [key: string]: unknown;
  id: string;
  short_title: string;
  jurisdiction: string;
}

interface SectionRow {
  [key: string]: unknown;
  legislation_id: string;
  number: string;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${BASE}/demo`, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${BASE}/legislation`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE}/privacy`, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${BASE}/terms`, changeFrequency: 'monthly', priority: 0.3 },
  ];

  // Priority acts (slug filter in JS — slug is derived from short_title).
  const actRows = await db.execute<ActRow>(sql`
    SELECT id, short_title, jurisdiction
    FROM legislation
    WHERE in_force = true
  `);
  const priorityActs = actRows
    .map((a) => ({
      id: a.id,
      slug: slugifyAct(a.short_title),
      urlJ: dbJurisdictionToUrl(a.jurisdiction),
    }))
    .filter((a) => PRIORITY_ACT_SLUGS.has(a.slug));

  if (priorityActs.length === 0) return staticPages;

  const actPages: MetadataRoute.Sitemap = priorityActs.map((a) => ({
    url: `${BASE}/legislation/${a.urlJ}/${a.slug}`,
    changeFrequency: 'monthly',
    priority: 0.7,
  }));

  // All clean sections of the priority acts, one query.
  const actIds = priorityActs.map((a) => a.id);
  const sectionRows = await db.execute<SectionRow>(sql`
    SELECT legislation_id, number
    FROM legislation_sections
    WHERE legislation_id = ANY(${actIds}::uuid[])
      AND level = 'section'
      AND text != ''
      AND number ~ '^[A-Za-z0-9.]+$'
  `);

  const actById = new Map(priorityActs.map((a) => [a.id, a]));
  const seen = new Set<string>();
  const sectionPages: MetadataRoute.Sitemap = [];
  for (const s of sectionRows) {
    const act = actById.get(s.legislation_id);
    if (!act) continue;
    const url = `${BASE}/legislation/${act.urlJ}/${act.slug}/s/${sectionToUrl(s.number)}`;
    if (seen.has(url)) continue;
    seen.add(url);
    sectionPages.push({
      url,
      changeFrequency: 'monthly',
      priority: 0.6,
    });
  }

  return [...staticPages, ...actPages, ...sectionPages];
}