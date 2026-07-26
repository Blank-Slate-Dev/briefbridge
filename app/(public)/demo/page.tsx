// app/(public)/demo/page.tsx
//
// Public demo. Logged-out visitors pick a curated question and watch a real
// BriefBridge answer stream in, with its real sources.
//
// HONESTY: these are pre-generated answers, not live inference, and the page
// says so plainly. Running live inference for anonymous traffic costs money
// and invites abuse; a demo that quietly pretends to be live would also be a
// bad first impression for the one audience that checks things.
//
// Server Component shell + client component for the streaming effect.

import type { Metadata } from 'next';
import { DEMO_ANSWERS } from '@/lib/demo/demo-data';
import { DemoClient } from './_components/demo-client';

export const metadata: Metadata = {
  title: 'See BriefBridge in action',
  description:
    'Real BriefBridge research answers to common Australian legal questions — grounded in NSW and High Court authority, cited paragraph by paragraph.',
  alternates: { canonical: '/demo' },
};

export default function DemoPage() {
  return (
    <div style={{ background: '#f4efe6', minHeight: '100vh', padding: '3.5rem 1.5rem 5rem' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: '#8a8577',
            marginBottom: 14,
          }}
        >
          Live demonstration
        </div>
        <h1
          style={{
            fontFamily: 'var(--font-fraunces), Georgia, serif',
            fontSize: 'clamp(32px, 5vw, 48px)',
            lineHeight: 1.1,
            letterSpacing: '-0.03em',
            color: '#1a1f2e',
            fontWeight: 400,
            margin: '0 0 18px',
          }}
        >
          See what a grounded answer <em style={{ color: '#3a4256' }}>looks like</em>
        </h1>
        <p
          style={{
            fontSize: 16,
            lineHeight: 1.65,
            color: '#3a4256',
            maxWidth: 620,
            margin: '0 0 10px',
          }}
        >
          Pick a question below. Every proposition is cited to a paragraph of a
          real judgment or a section of the Act — and where the law wasn&rsquo;t
          retrieved, BriefBridge says so instead of guessing.
        </p>
        <p style={{ fontSize: 13, color: '#8a8577', margin: '0 0 36px' }}>
          These are answers BriefBridge produced, saved here so you can read them
          without signing up. Sign in to ask your own.
        </p>

        <DemoClient answers={DEMO_ANSWERS} />
      </div>
    </div>
  );
}