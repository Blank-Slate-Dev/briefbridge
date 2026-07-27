// app/(app)/settings/_components/subscription-card.tsx
//
// Subscription panel for the settings page, with an in-app manage modal.
//
// NO REDIRECTS: cancelling and resuming are server actions against the Stripe
// API, so the user never leaves the page. Stripe's hosted portal refuses to be
// iframed, which rules out embedding it, and sending someone off-site to
// perform the one action they most want is a poor experience — so cancel is
// built here instead.
//
// What is NOT here: updating a card, and invoice history. Both would mean
// either handling card data or building a second surface, and neither is worth
// it until someone asks. Those still live in the portal.
//
// Cancellation is always at PERIOD END, never immediate — the user has paid
// for the rest of the period and getAccessState already honours that.

'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  cancelSubscriptionAction,
  resumeSubscriptionAction,
} from '../../billing/_actions';

const NAVY = '#1a1f2e';
const SOFT = '#3a4256';
const MUTED = '#8a8577';
const GOLD = '#c9a24b';
const BORDER = '#e7e0d2';
const DANGER = '#b4453a';

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
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'cancelled' | 'resumed' | null>(null);

  // Escape closes the modal. Registered only while it is open so there is no
  // stray listener on a page that isn't showing one.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') closeModal();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  function closeModal() {
    setOpen(false);
    setConfirming(false);
    setError(null);
    setDone(null);
  }

  function doCancel() {
    setError(null);
    startTransition(async () => {
      const result = await cancelSubscriptionAction();
      if (result.ok) {
        setDone('cancelled');
        setConfirming(false);
      } else {
        setError(result.error);
      }
    });
  }

  function doResume() {
    setError(null);
    startTransition(async () => {
      const result = await resumeSubscriptionAction();
      if (result.ok) {
        setDone('resumed');
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

  // Local optimism: after a successful action the server state has changed but
  // this component's props are from the previous render. Reflect the new
  // position immediately rather than making the user reload.
  const effectiveCancelAtPeriodEnd =
    done === 'cancelled' ? true : done === 'resumed' ? false : cancelAtPeriodEnd;

  const pillLabel = isTrialing
    ? 'Free trial'
    : status === 'past_due'
      ? 'Payment failed'
      : effectiveCancelAtPeriodEnd
        ? 'Cancelling'
        : 'Active';

  const pillBackground = isTrialing
    ? 'rgba(201,162,75,0.18)'
    : status === 'past_due'
      ? 'rgba(180,69,58,0.14)'
      : effectiveCancelAtPeriodEnd
        ? 'rgba(138,133,119,0.18)'
        : 'rgba(60,140,90,0.14)';

  // The date access actually runs out. During a trial that is the trial end;
  // afterwards it is the end of the paid period.
  const accessUntil = isTrialing ? trialEnd : currentPeriodEnd;

  return (
    <section className="bb-settings-card">
      <h2 className="bb-settings-card-title">Subscription</h2>

      <div style={{ margin: '0 0 12px' }}>
        <span
          style={{
            display: 'inline-block',
            padding: '3px 10px',
            borderRadius: 999,
            background: pillBackground,
            color: NAVY,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {pillLabel}
        </span>
      </div>

      <p className="bb-settings-card-help" style={{ marginBottom: 18 }}>
        {effectiveCancelAtPeriodEnd && accessUntil ? (
          <>
            Cancelled. Your access continues until{' '}
            <strong>{formatDate(accessUntil)}</strong>, and you won&rsquo;t be
            charged again.
          </>
        ) : isTrialing && trialEnd ? (
          <>
            Your free trial runs until <strong>{formatDate(trialEnd)}</strong>.
            You&rsquo;ll be charged $99 on that date unless you cancel before
            then.
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
        onClick={() => setOpen(true)}
        style={{
          background: 'transparent',
          color: NAVY,
          border: `1px solid ${GOLD}`,
          padding: '11px 22px',
          borderRadius: 999,
          font: 'inherit',
          fontSize: 14,
          fontWeight: 500,
          cursor: 'pointer',
        }}
      >
        Manage subscription
      </button>

      {/* ------------------------------- modal ------------------------------ */}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Manage subscription"
          onClick={closeModal}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(26,31,46,0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            zIndex: 100,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              border: `1px solid ${BORDER}`,
              borderTop: `4px solid ${GOLD}`,
              borderRadius: 16,
              padding: '28px 30px 26px',
              width: '100%',
              maxWidth: 460,
              boxShadow: '0 24px 60px rgba(26,31,46,0.22)',
            }}
          >
            <h3
              style={{
                fontFamily: 'var(--font-fraunces), Georgia, serif',
                fontSize: 22,
                fontWeight: 400,
                color: NAVY,
                margin: '0 0 10px',
              }}
            >
              {done === 'cancelled'
                ? 'Subscription cancelled'
                : done === 'resumed'
                  ? 'Subscription resumed'
                  : confirming
                    ? 'Cancel your subscription?'
                    : 'Manage subscription'}
            </h3>

            <p
              style={{
                fontSize: 14.5,
                lineHeight: 1.65,
                color: SOFT,
                margin: '0 0 22px',
              }}
            >
              {done === 'cancelled' ? (
                <>
                  You keep full access until{' '}
                  <strong style={{ color: NAVY }}>
                    {formatDate(accessUntil)}
                  </strong>
                  . Nothing further will be charged.
                </>
              ) : done === 'resumed' ? (
                <>
                  Your subscription will continue as normal. Next payment{' '}
                  <strong style={{ color: NAVY }}>
                    {formatDate(currentPeriodEnd)}
                  </strong>
                  .
                </>
              ) : confirming ? (
                <>
                  You&rsquo;ll keep access until{' '}
                  <strong style={{ color: NAVY }}>
                    {formatDate(accessUntil)}
                  </strong>
                  , then your account reverts to no subscription. You can resume
                  any time before then.
                </>
              ) : effectiveCancelAtPeriodEnd ? (
                <>
                  Your subscription is set to end on{' '}
                  <strong style={{ color: NAVY }}>
                    {formatDate(accessUntil)}
                  </strong>
                  . Resume it to keep your access running.
                </>
              ) : isTrialing ? (
                <>
                  You&rsquo;re on a free trial until{' '}
                  <strong style={{ color: NAVY }}>
                    {formatDate(trialEnd)}
                  </strong>
                  . Cancel before then and you won&rsquo;t be charged at all.
                </>
              ) : (
                <>
                  $99/month AUD. Cancelling stops future payments and keeps your
                  access until the end of the period you&rsquo;ve paid for.
                </>
              )}
            </p>

            {error && (
              <p
                style={{
                  fontSize: 13,
                  color: DANGER,
                  margin: '0 0 16px',
                }}
              >
                {error}
              </p>
            )}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {done ? (
                <button
                  type="button"
                  onClick={closeModal}
                  style={primaryButton(false)}
                >
                  Done
                </button>
              ) : confirming ? (
                <>
                  <button
                    type="button"
                    onClick={doCancel}
                    disabled={isPending}
                    style={dangerButton(isPending)}
                  >
                    {isPending ? 'Cancelling…' : 'Yes, cancel'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    disabled={isPending}
                    style={ghostButton(isPending)}
                  >
                    Keep subscription
                  </button>
                </>
              ) : effectiveCancelAtPeriodEnd ? (
                <>
                  <button
                    type="button"
                    onClick={doResume}
                    disabled={isPending}
                    style={primaryButton(isPending)}
                  >
                    {isPending ? 'Resuming…' : 'Resume subscription'}
                  </button>
                  <button
                    type="button"
                    onClick={closeModal}
                    disabled={isPending}
                    style={ghostButton(isPending)}
                  >
                    Close
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    style={ghostButton(false)}
                  >
                    Cancel subscription
                  </button>
                  <button
                    type="button"
                    onClick={closeModal}
                    style={primaryButton(false)}
                  >
                    Close
                  </button>
                </>
              )}
            </div>

            <p style={{ fontSize: 12, color: MUTED, margin: '18px 0 0' }}>
              Card changes and invoices are handled by Stripe — ask if you want
              those in here too.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

// =============================================================================
// Button styles
// =============================================================================
//
// Inline rather than in settings.css, for the same reason as billing-client:
// the app shell's inherited text colour is tuned for the navy sidebar and
// disappears against the cream content background, so colours are set
// explicitly here.

function baseButton(disabled: boolean): React.CSSProperties {
  return {
    padding: '11px 22px',
    borderRadius: 999,
    font: 'inherit',
    fontSize: 14,
    fontWeight: 500,
    cursor: disabled ? 'wait' : 'pointer',
    opacity: disabled ? 0.7 : 1,
  };
}

function primaryButton(disabled: boolean): React.CSSProperties {
  return {
    ...baseButton(disabled),
    background: NAVY,
    color: '#f4efe6',
    border: 'none',
    fontWeight: 600,
  };
}

function ghostButton(disabled: boolean): React.CSSProperties {
  return {
    ...baseButton(disabled),
    background: 'transparent',
    color: NAVY,
    border: `1px solid ${BORDER}`,
  };
}

function dangerButton(disabled: boolean): React.CSSProperties {
  return {
    ...baseButton(disabled),
    background: DANGER,
    color: '#fff',
    border: 'none',
    fontWeight: 600,
  };
}