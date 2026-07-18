// app/robots.ts
//
// Serves /robots.txt.
//
// Strategy (per SEO playbook):
//   - Allow all crawlers, INCLUDING AI crawlers (GPTBot, Google-Extended,
//     PerplexityBot etc). In a ~78%-AI-Overview legal vertical, being
//     citable by AI engines is a distribution channel, not a leak.
//   - Disallow the private app surface (workspace, admin, api, auth
//     plumbing) — there is nothing indexable there and crawling it wastes
//     budget and risks soft-404 noise.
//   - Point at the sitemap index.

import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/admin/',
          '/matters',
          '/chat',
          '/firm',
          '/invite/',
          '/auth/',
        ],
      },
    ],
    sitemap: 'https://briefbridge.ai/sitemap.xml',
  };
}