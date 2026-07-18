// app/sitemap.ts
//
// Serves /sitemap.xml.
//
// CURRENT SCOPE: the public static pages. When programmatic legislation /
// case pages ship, this becomes a sitemap INDEX with segmented child
// sitemaps (Google caps 50,000 URLs per sitemap file) — segment by content
// type so indexation can be tracked per segment in Search Console. The
// structure below is deliberately data-driven so that extension is a small
// change, not a rewrite.
//
// lastModified discipline: only set a date that reflects a REAL content
// change. Blanket daily updates train Google to distrust the signal.

import type { MetadataRoute } from 'next';

const BASE = 'https://briefbridge.ai';

export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: `${BASE}/`,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${BASE}/privacy`,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: `${BASE}/terms`,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
  ];

  return staticPages;
}