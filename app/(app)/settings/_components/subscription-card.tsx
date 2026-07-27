// app/(app)/settings/_components/subscription-card.tsx
//
// Subscription panel for the settings page.
//
// Deliberately thin, for the same reason the billing page is: cancelling,
// changing a card and downloading invoices all happen in Stripe's hosted
// customer portal. This card's job is to state the current position plainly —
// especially WHEN THE NEXT CHARGE FALLS, which is the thing someone opening
// settings is usually looking for — and then hand off.
//
// Anyone without a subscription is sent to /billing rather than the portal:
// the portal needs a Stripe customer, and they don't have one yet.
//
// NOTE: navigation is done with a button + window.location rather than an
// anchor tag. Nothing subtle — it just keeps this file free of raw <a> markup.

'use client';

import { useState, useTransition } from 'react';
import { createPortalSessionAction } from '../../billing/_actions';

const NAVY = '#1a1f2e';
const GOLD = '#c9a24b';

interface Props {
  hasAccess: boolean;
  status: string | null;
  isTrialing: boolean;
  trialEnd: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function SubscriptionCard({
  hasAccess,
  status,
  isTrialing,
  trialEnd,
  currentPeriodEnd,
  cancelAtPeriodEnd,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function openPortal() {
    setError(null);
    startTransition(async () => {
      const result = await createPortalSessionAction();
      if (result.ok) {
        window.location.href = result.url;
      } else {
        setError(result.error);
      }
    });
  }

  function goToBilling() {
    window.location.href = '/billing';
  }

  // ------------------------------------------------------------- no access
  if (!hasAccess) {
    return (
      <section className="bb-settings-card">
        <h2 className="bb-settings-card-title">Subscription</h2>
        <p className="bb-settings-card-help">
          You don&rsquo;t have an active subscription. BriefBridge research is
          $99/month AUD, with a 7-day free trial.
        </p>
        <button
          type="button"
          className="bb-btn bb-btn-primary"
          onClick={goToBilling}
        >
          Go to billing &rarr;
        </button>
      </section>
    );
  }

  // ------------------------------------------------------------ has access
  const pillLabel = isTrialing
    ? 'Free trial'
    : status === 'past_due'
      ? 'Payment failed'
      : cancelAtPeriodEnd
        ? 'Cancelling'
        : 'Active';

  return (
    <section className="bb-settings-card">
      <h2 className="bb-settings-card-title">Subscription</h2>

      <div style={{ margin: '0 0 12px' }}>
        <span
          style={{
            display: 'inline-block',
            padding: '3px 10px',
            borderRadius: 999,
            background: isTrialing
              ? 'rgba(201,162,75,0.18)'
              : status === 'past_due'
                ? 'rgba(180,69,58,0.14)'
                : 'rgba(60,140,90,0.14)',
            color: NAVY,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {pillLabel}
        </span>
      </div>

      <p className="bb-settings-card-help" style={{ marginBottom: 18 }}>
        {isTrialing && trialEnd ? (
          <>
            Your free trial runs until <strong>{formatDate(trialEnd)}</strong>.
            You&rsquo;ll be charged $99 on that date unless you cancel before
            then.
          </>
        ) : cancelAtPeriodEnd && currentPeriodEnd ? (
          <>
            Cancelled. Your access continues until{' '}
            <strong>{formatDate(currentPeriodEnd)}</strong>, and you won&rsquo;t
            be charged again.
          </>
        ) : status === 'past_due' ? (
          <>
            We couldn&rsquo;t process your last payment. Update your card to
            keep your access.
          </>
        ) : currentPeriodEnd ? (
          <>
            $99/month. Next payment{' '}
            <strong>{formatDate(currentPeriodEnd)}</strong>.
          </>
        ) : (
          <>$99/month.</>
        )}
      </p>

      <button
        type="button"
        onClick={openPortal}
        disabled={isPending}
        style={{
          background: 'transparent',
          color: NAVY,
          border: `1px solid ${GOLD}`,
          padding: '11px 22px',
          borderRadius: 999,
          font: 'inherit',
          fontSize: 14,
          fontWeight: 500,
          cursor: isPending ? 'wait' : 'pointer',
          opacity: isPending ? 0.7 : 1,
        }}
      >
        {isPending ? 'Opening&hellip;' : 'Manage subscription'}
      </button>

      <p className="bb-settings-count" style={{ marginTop: 12 }}>
        Cancel, change your card, or download invoices in Stripe&rsquo;s secure
        portal.
      </p>

      {error && (
        <p
          className="bb-settings-status bb-settings-status-error"
          style={{ marginTop: 10 }}
        >
          {error}
        </p>
      )}
    </section>
  );
}