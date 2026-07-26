// app/(app)/billing/_components/billing-client.tsx
//
// Client half of the billing page: the subscribe button, or the current state
// plus a link into Stripe's customer portal.
//
// Inline styles, consistent with the other pages built recently — the app
// shell's inherited text colour is light (for the navy sidebar) and disappears
// on the cream content background, so colours are set explicitly.

'use client';

import { useState, useTransition } from 'react';
import {
  createCheckoutSessionAction,
  createPortalSessionAction,
} from '../_actions';

const NAVY = '#1a1f2e';
const SOFT = '#3a4256';
const MUTED = '#8a8577';
const GOLD = '#c9a24b';
const BORDER = '#e7e0d2';

interface Props {
  hasAccess: boolean;
  status: string | null;
  isTrialing: boolean;
  trialEnd: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialDays: number;
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function BillingClient({
  hasAccess,
  status,
  isTrialing,
  trialEnd,
  currentPeriodEnd,
  cancelAtPeriodEnd,
  trialDays,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go(action: () => Promise<{ ok: true; url: string } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        window.location.href = result.url;
      } else {
        setError(result.error);
      }
    });
  }

  // ---------------------------------------------------------------- no plan
  if (!hasAccess) {
    return (
      <div>
        <section
          style={{
            background: '#fff',
            border: `1px solid ${BORDER}`,
            borderTop: `4px solid ${GOLD}`,
            borderRadius: 16,
            padding: '2rem 2.25rem',
            marginBottom: 20,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
            <span
              style={{
                fontFamily: 'var(--font-fraunces), Georgia, serif',
                fontSize: 34,
                color: NAVY,
              }}
            >
              $99
            </span>
            <span style={{ fontSize: 14, color: MUTED }}>AUD per month</span>
          </div>
          <p style={{ fontSize: 14, color: MUTED, margin: '0 0 22px' }}>
            {trialDays} days free, then $99/month. Cancel anytime.
          </p>

          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 26px' }}>
            {[
              'Semantic search across ~57,000 NSW judgments and the High Court',
              'Every in-force NSW and Commonwealth Act, section by section',
              'Answers cited to the paragraph, with the source passage shown',
              'Research shaped for how you practise — solicitor, barrister, in-house',
              'Matters, files, and firm collaboration',
            ].map((f) => (
              <li
                key={f}
                style={{
                  fontSize: 14.5,
                  lineHeight: 1.6,
                  color: SOFT,
                  padding: '7px 0 7px 24px',
                  position: 'relative',
                }}
              >
                <span style={{ position: 'absolute', left: 0, color: GOLD }}>✓</span>
                {f}
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={() => go(createCheckoutSessionAction)}
            disabled={isPending}
            style={{
              background: NAVY,
              color: '#f4efe6',
              border: 'none',
              padding: '13px 28px',
              borderRadius: 999,
              font: 'inherit',
              fontSize: 15,
              fontWeight: 600,
              cursor: isPending ? 'wait' : 'pointer',
              opacity: isPending ? 0.7 : 1,
            }}
          >
            {isPending ? 'Opening…' : `Start ${trialDays}-day free trial →`}
          </button>

          <p style={{ fontSize: 12, color: MUTED, margin: '14px 0 0' }}>
            Card required. You won&rsquo;t be charged until the trial ends, and
            you can cancel before then.
          </p>
        </section>

        {error && <p style={{ fontSize: 13, color: '#b4453a' }}>{error}</p>}
      </div>
    );
  }

  // ------------------------------------------------------------ has access
  return (
    <div>
      <section
        style={{
          background: '#fff',
          border: `1px solid ${BORDER}`,
          borderRadius: 16,
          padding: '1.75rem 2rem',
          marginBottom: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span
            style={{
              display: 'inline-block',
              padding: '3px 10px',
              borderRadius: 999,
              background: isTrialing ? 'rgba(201,162,75,0.18)' : 'rgba(60,140,90,0.14)',
              color: NAVY,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {isTrialing ? 'Free trial' : status === 'past_due' ? 'Payment failed' : 'Active'}
          </span>
        </div>

        <p style={{ fontSize: 15, lineHeight: 1.65, color: SOFT, margin: '0 0 6px' }}>
          {isTrialing && trialEnd ? (
            <>
              Your free trial runs until <strong style={{ color: NAVY }}>{formatDate(trialEnd)}</strong>.
              After that it&rsquo;s $99/month unless you cancel.
            </>
          ) : cancelAtPeriodEnd && currentPeriodEnd ? (
            <>
              Your subscription is cancelled and access continues until{' '}
              <strong style={{ color: NAVY }}>{formatDate(currentPeriodEnd)}</strong>.
            </>
          ) : status === 'past_due' ? (
            <>
              We couldn&rsquo;t process your last payment. Update your card to
              keep your access.
            </>
          ) : currentPeriodEnd ? (
            <>
              $99/month. Next payment{' '}
              <strong style={{ color: NAVY }}>{formatDate(currentPeriodEnd)}</strong>.
            </>
          ) : (
            <>$99/month.</>
          )}
        </p>
      </section>

      <button
        type="button"
        onClick={() => go(createPortalSessionAction)}
        disabled={isPending}
        style={{
          background: 'transparent',
          color: NAVY,
          border: `1px solid ${BORDER}`,
          padding: '11px 22px',
          borderRadius: 999,
          font: 'inherit',
          fontSize: 14,
          fontWeight: 500,
          cursor: isPending ? 'wait' : 'pointer',
        }}
      >
        {isPending ? 'Opening…' : 'Manage billing, card and invoices'}
      </button>

      {error && <p style={{ fontSize: 13, color: '#b4453a', marginTop: 12 }}>{error}</p>}
    </div>
  );
}