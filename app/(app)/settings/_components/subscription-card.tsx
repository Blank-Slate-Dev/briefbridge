// app/(app)/settings/_components/subscription-card.tsx
//
// Subscription status and management, rendered as a COMPACT settings row.
//
// =============================================================================
// WHY THIS ROW IS WIDE, NOT TWO-COLUMN
// =============================================================================
//
// It uses .bb-set-row-wide: the label takes the width and the buttons shrink
// to their content on the right. The standard two-column row trapped the
// explanation in a 200px column, where "BriefBridge Research is A$99/month,
// or A$999/year, with a 7-day free trial" wrapped three lines deep beside a
// single small button — a tall block of mostly empty space.
//
// The rows below it (role cards, practice-area checkboxes) keep the standard
// layout, because their controls genuinely need the width. This one doesn't:
// its control is a button.
//
// Status is a single line too — pill and next-charge date side by side rather
// than a stacked pill above a definition list.
//
// =============================================================================
// WHY THERE IS NO "DANGER ZONE" BOX
// =============================================================================
//
// Cancel used to live in a red-outlined box at the bottom of the page. That
// is the right pattern for ACCOUNT DELETION — irreversible, destroys data,
// must be hard to hit by accident. It is the wrong pattern for cancelling a
// subscription, which destroys nothing: access runs to the end of the paid
// period, matters and files stay put, and resuming is one click. Dressing it
// up as a hazard overstates the stakes.
//
// Cancel is a quiet secondary button; the confirmation modal prevents
// accidents.
//
// =============================================================================
// THE CANCEL FLOW, AND WHY IT IS SHORT
// =============================================================================
//
// Two clicks: "Cancel subscription" opens one modal, "Yes, cancel" ends it.
// No reason field, no phone call, no offer wall. Deliberately against a
// common pattern, for three reasons:
//
//   1. THE AUDIENCE. These are lawyers. A cancellation flow engineered to be
//      difficult is precisely what this profession notices and resents.
//
//   2. THE LAW IS MOVING. Subscription traps and hard-to-exit renewals are
//      current ACCC compliance priorities, and Treasury is consulting on an
//      unfair-trading-practices prohibition aimed at conduct that makes
//      cancellation "practically very difficult".
//
//   3. IT IS ALSO GOOD BUSINESS. Australian survey work found the large
//      majority would buy from a company again if cancelling had been quick.
//
// Cancellation is at PERIOD END, never immediate — they have paid for the
// rest of the period and getAccessState already honours that. This matters
// more on the annual plan, where that can be most of a year.

'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  cancelSubscriptionAction,
  resumeSubscriptionAction,
} from '../../billing/_actions';
import { PRICE_AUD, PRICE_AUD_YEARLY, formatAuDate } from '@/lib/billing/copy';

interface Props {
  hasAccess: boolean;
  status: string | null;
  isTrialing: boolean;
  trialEnd: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
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
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'cancelled' | null>(null);
  const [resumed, setResumed] = useState(false);

  // Escape closes the modal. Registered only while it is open, so there is no
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
    setError(null);
    setDone(null);
  }

  function doCancel() {
    setError(null);
    startTransition(async () => {
      const result = await cancelSubscriptionAction();
      if (result.ok) {
        setDone('cancelled');
        setResumed(false);
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
        setResumed(true);
      } else {
        setError(result.error);
      }
    });
  }

  function goToBilling() {
    window.location.href = '/billing';
  }

  // ============================================================== no access
  if (!hasAccess) {
    return (
      <div className="bb-set-list">
        <div className="bb-set-row bb-set-row-wide">
          <div className="bb-set-label">
            <p className="bb-set-label-title">Subscription</p>
            <p className="bb-set-label-help">
              BriefBridge Research is A${PRICE_AUD} a month, or A$
              {PRICE_AUD_YEARLY} a year, with a 7-day free trial.
            </p>
          </div>
          <div className="bb-set-actions">
            <button
              type="button"
              className="bb-btn bb-btn-small bb-btn-primary"
              onClick={goToBilling}
            >
              Start free trial
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Local optimism: after a successful action the server state has changed,
  // but this component's props are from the previous render. Reflect the new
  // position immediately rather than making the user reload.
  const ending = resumed ? false : done === 'cancelled' ? true : cancelAtPeriodEnd;

  const pillClass = isTrialing
    ? 'bb-account-pill-trial'
    : status === 'past_due'
      ? 'bb-account-pill-warn'
      : ending
        ? 'bb-account-pill-ending'
        : 'bb-account-pill-active';

  const pillLabel = isTrialing
    ? 'Free trial'
    : status === 'past_due'
      ? 'Payment failed'
      : ending
        ? 'Ending'
        : 'Active';

  // The date access actually runs out. During a trial that is the trial end;
  // afterwards it is the end of the paid period.
  const accessUntil = isTrialing ? trialEnd : currentPeriodEnd;

  const factLabel = ending
    ? 'Access until'
    : isTrialing
      ? 'First charge'
      : 'Next charge';

  return (
    <>
      <div className="bb-set-list">
        <div className="bb-set-row bb-set-row-wide">
          <div className="bb-set-label">
            <p className="bb-set-label-title">Subscription</p>
            <p className="bb-account-statusline">
              <span className={`bb-account-pill bb-account-pill-inline ${pillClass}`}>
                {pillLabel}
              </span>
              {accessUntil && (
                <span>
                  {factLabel} <strong>{formatAuDate(accessUntil)}</strong>
                </span>
              )}
              <span>Card and invoices on the billing page</span>
            </p>
          </div>

          <div className="bb-set-actions">
            {ending ? (
              <button
                type="button"
                className="bb-btn bb-btn-small bb-btn-primary"
                onClick={doResume}
                disabled={isPending}
              >
                {isPending ? 'Resuming…' : 'Resume'}
              </button>
            ) : (
              <button
                type="button"
                className="bb-btn bb-btn-small bb-btn-ghost bb-btn-quiet"
                onClick={() => setOpen(true)}
              >
                Cancel
              </button>
            )}

            <button
              type="button"
              className="bb-btn bb-btn-small bb-btn-outline"
              onClick={goToBilling}
            >
              Billing
            </button>
          </div>
        </div>

        {(status === 'past_due' || error) && (
          <div className="bb-set-row bb-set-row-wide" style={{ paddingTop: 0 }}>
            <div className="bb-set-label">
              {status === 'past_due' && (
                <p className="bb-account-error" style={{ marginTop: 0 }}>
                  We couldn&rsquo;t process your last payment. Update your card
                  on the billing page to keep your access.
                </p>
              )}
              {error && (
                <p className="bb-account-error" style={{ marginTop: 0 }}>
                  {error}
                </p>
              )}
            </div>
            <div />
          </div>
        )}
      </div>

      {/* ------------------------------- modal ---------------------------- */}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Cancel subscription"
          className="bb-account-modal-backdrop"
          onClick={closeModal}
        >
          <div className="bb-account-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="bb-account-modal-title">
              {done === 'cancelled'
                ? 'Subscription cancelled'
                : 'Cancel your subscription?'}
            </h3>

            <p className="bb-account-modal-body">
              {done === 'cancelled' ? (
                <>
                  You keep full access until{' '}
                  <strong>{formatAuDate(accessUntil)}</strong>. Nothing further
                  will be charged, and you can resume any time before then.
                </>
              ) : isTrialing && accessUntil ? (
                <>
                  Your trial runs to <strong>{formatAuDate(accessUntil)}</strong>{' '}
                  and you won&rsquo;t be charged at all. You keep access until
                  then.
                </>
              ) : accessUntil ? (
                <>
                  You keep access until{' '}
                  <strong>{formatAuDate(accessUntil)}</strong> — the period
                  you&rsquo;ve already paid for — then your account reverts to
                  no subscription. Your matters and files stay where they are.
                </>
              ) : (
                <>
                  You keep access for the rest of the period you&rsquo;ve paid
                  for. Your matters and files stay where they are.
                </>
              )}
            </p>

            {error && <p className="bb-account-error">{error}</p>}

            <div className="bb-account-modal-actions">
              {done === 'cancelled' ? (
                <button
                  type="button"
                  className="bb-btn bb-btn-primary"
                  onClick={closeModal}
                >
                  Done
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="bb-btn bb-btn-outline"
                    onClick={closeModal}
                    disabled={isPending}
                  >
                    Keep subscription
                  </button>
                  <button
                    type="button"
                    className="bb-btn bb-btn-danger-solid"
                    onClick={doCancel}
                    disabled={isPending}
                  >
                    {isPending ? 'Cancelling…' : 'Yes, cancel'}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}