// app/robots.ts
//
// Serves /robots.txt.
//
// Strategy:
//   - Allow all crawlers, INCLUDING AI crawlers. In a legal vertical where a
//     large share of informational queries are now answered by AI Overviews,
//     ChatGPT and Perplexity rather than by a click, being CITABLE by those
//     engines is a distribution channel, not a leak. A site that blocks them
//     disappears from the answers people actually read.
//   - Disallow the private app surface (workspace, admin, api, auth
//     plumbing) — there is nothing indexable there, crawling it wastes budget
//     and risks soft-404 noise.
//   - Point at the sitemap index.
//
// =============================================================================
// WHY THE AI BOTS ARE NAMED EXPLICITLY WHEN "*" ALREADY ALLOWS THEM
// =============================================================================
//
// The wildcard rule below is sufficient on its own — robots.txt is permissive
// by default and every one of these agents would be allowed anyway. The named
// rules exist for two reasons:
//
//   1. INTENT IS AUDITABLE. "Allow AI crawlers" is a deliberate strategic
//      choice, not an oversight. Written down, it survives someone later
//      tightening the wildcard rule without realising what it costs.
//
//   2. SPECIFICITY WINS. robots.txt matches the MOST SPECIFIC user-agent
//      block, and a crawler that finds its own name stops reading the
//      wildcard entirely. If a future disallow is added to "*" for some
//      unrelated reason, these agents keep their access.
//
// The agents, and why each matters here:
//   GPTBot          — trains and powers ChatGPT's browsing
//   OAI-SearchBot   — ChatGPT search, the one that produces citations
//   ChatGPT-User    — fetches a page when a user asks about it directly
//   PerplexityBot   — Perplexity indexing; heavily citation-driven
//   ClaudeBot       — Anthropic's crawler
//   Google-Extended — controls Gemini/AI Overviews use, SEPARATELY from
//                     Googlebot. Blocking it removes you from AI Overviews
//                     while leaving normal Search unaffected.
//   Applebot-Extended — Apple Intelligence
//
// The same disallow list applies to all of them: they have no more business
// in the private app than Googlebot does.

import type { MetadataRoute } from 'next';

// The private surface. Nothing here is indexable, and several routes are
// authenticated — a crawler hitting them gets a redirect to /login at best.
const PRIVATE_PATHS = [
  '/api/',
  '/admin/',
  '/matters',
  '/chat',
  '/firm',
  '/settings',
  '/billing',
  '/invite/',
  '/auth/',
];

const AI_CRAWLERS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'PerplexityBot',
  'ClaudeBot',
  'Claude-Web',
  'Google-Extended',
  'Applebot-Extended',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: PRIVATE_PATHS,
      },
      ...AI_CRAWLERS.map((userAgent) => ({
        userAgent,
        allow: '/',
        disallow: PRIVATE_PATHS,
      })),
    ],
    sitemap: 'https://briefbridge.ai/sitemap.xml',
  };
}
