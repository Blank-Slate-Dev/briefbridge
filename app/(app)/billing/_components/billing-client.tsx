// app/(app)/billing/_components/billing-client.tsx
//
// Client half of the billing page. ZERO inline styles — every rule comes from
// settings.css, which is what keeps this page and /settings identical.
//
// =============================================================================
// TWO PLANS, TWO IDENTICAL CARDS
// =============================================================================
//
// The chooser is two structurally identical cards side by side: same sections
// in the same order, differing only in the numbers and the badge. That is
// what makes them the same height without any height rules — matching
// structure does the work that fixed heights were previously being asked to
// do, and it keeps doing it when the copy changes.
//
// Both plans buy exactly the same product. There is deliberately no feature
// gating between them: an artificial split to push people onto the annual
// plan is the kind of thing this audience reads as a tell, and the discount
// is a good enough reason on its own.
//
// The saving is COMPUTED in lib/billing/copy.ts, never typed by hand — a
// "Save 20%" badge beside prices that actually save 16% is a
// misrepresentation, and a checkable one.
//
// FLOW: choose a plan, then Continue to payment swaps the pair for the
// embedded Stripe form in place. Nothing navigates.

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createPortalSessionAction } from '../_actions';
import { EmbeddedCheckoutPanel } from './embedded-checkout-panel';
import { InvoiceTable } from './invoice-table';
import type { InvoiceRow } from '@/lib/billing/invoices';
import {
  PLAN_FEATURES,
  PRICE_AUD,
  PRICE_AUD_YEARLY,
  formatAuDate,
  monthlyPlan,
  trialTerms,
  trustPoints,
  yearlyPlan,
  type PlanCopy,
} from '@/lib/billing/copy';

interface Props {
  hasAccess: boolean;
  status: string | null;
  isTrialing: boolean;
  trialEnd: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialDays: number;
  projectedChargeDate: string;
  invoices: InvoiceRow[];
  yearlyAvailable: boolean;
  /** Stripe price id on the active subscription, for naming the plan. */
  activePriceId: string | null;
  yearlyPriceId: string;
}

export function BillingClient({
  hasAccess,
  status,
  isTrialing,
  trialEnd,
  currentPeriodEnd,
  cancelAtPeriodEnd,
  trialDays,
  projectedChargeDate,
  invoices,
  yearlyAvailable,
  activePriceId,
  yearlyPriceId,
}: Props) {
  const router = useRouter();
  const [interval, setInterval] = useState<'month' | 'year'>('month');
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // The webhook has (probably) written the subscription row by now. Re-running
  // the Server Component is what reveals it — getAccessState is read there.
  function handleSubscribed() {
    router.refresh();
  }

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

  // ============================================================== no access
  if (!hasAccess) {
    const chargeDate = formatAuDate(projectedChargeDate);
    const plans: PlanCopy[] = yearlyAvailable
      ? [monthlyPlan(), yearlyPlan()]
      : [monthlyPlan()];

    if (checkoutOpen) {
      return (
        <div className="bb-account-body">
          <section className="bb-account-card bb-account-card-feature">
            <div className="bb-checkout-head">
              <div>
                <h2 className="bb-account-card-title">
                  {interval === 'year' ? 'Yearly plan' : 'Monthly plan'}
                </h2>
                <p className="bb-account-card-help" style={{ margin: 0 }}>
                  {trialDays} days free, then A$
                  {interval === 'year' ? PRICE_AUD_YEARLY : PRICE_AUD} on{' '}
                  {chargeDate}.
                </p>
              </div>
              <button
                type="button"
                className="bb-btn bb-btn-small bb-btn-ghost"
                onClick={() => setCheckoutOpen(false)}
              >
                Change plan
              </button>
            </div>

            <div className="bb-account-checkout">
              <EmbeddedCheckoutPanel
                interval={interval}
                onSubscribed={handleSubscribed}
              />
            </div>
          </section>
        </div>
      );
    }

    return (
      <div>
        <div className="bb-plan-grid">
          {plans.map((plan) => {
            const selected = interval === plan.interval;
            return (
              <button
                key={plan.interval}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`bb-plan-card${selected ? ' bb-plan-card-selected' : ''}`}
                onClick={() => setInterval(plan.interval)}
              >
                {plan.badge && (
                  <span className="bb-plan-badge">{plan.badge}</span>
                )}

                <span className="bb-plan-head">
                  <span className="bb-choice-dot" aria-hidden="true" />
                  <span className="bb-plan-name">{plan.name}</span>
                </span>

                <span className="bb-plan-tagline">{plan.tagline}</span>

                <span className="bb-plan-price">
                  <span className="bb-plan-price-amount">{plan.amount}</span>
                  <span className="bb-plan-price-unit">{plan.unit}</span>
                </span>

                <span className="bb-plan-detail">{plan.detail}</span>

                <span className="bb-plan-rule" />

                <span className="bb-plan-features">
                  {PLAN_FEATURES.map((f) => (
                    <span key={f} className="bb-plan-feature">
                      {f}
                    </span>
                  ))}
                </span>
              </button>
            );
          })}
        </div>

        <div className="bb-plan-cta">
          <ul className="bb-account-terms">
            {trialTerms(chargeDate, trialDays, interval).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>

          <button
            type="button"
            className="bb-btn bb-btn-primary bb-btn-large"
            onClick={() => setCheckoutOpen(true)}
          >
            Continue to payment
          </button>
        </div>

        <ul className="bb-plan-trust">
          {trustPoints().map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>

        {error && <p className="bb-account-error">{error}</p>}
      </div>
    );
  }

  // ============================================================= has access
  const onYearly = Boolean(
    activePriceId && yearlyPriceId && activePriceId === yearlyPriceId,
  );

  const pillClass = isTrialing
    ? 'bb-account-pill-trial'
    : status === 'past_due'
      ? 'bb-account-pill-warn'
      : cancelAtPeriodEnd
        ? 'bb-account-pill-ending'
        : 'bb-account-pill-active';

  const pillLabel = isTrialing
    ? 'Free trial'
    : status === 'past_due'
      ? 'Payment failed'
      : cancelAtPeriodEnd
        ? 'Ending'
        : 'Active';

  const nextChargeLabel = isTrialing ? 'First charge' : 'Next charge';
  const nextChargeDate = isTrialing ? trialEnd : currentPeriodEnd;

  return (
    <div className="bb-account-body">
      {/* Current plan. */}
      <section className="bb-account-card">
        <div className={`bb-account-pill ${pillClass}`}>{pillLabel}</div>

        <dl className="bb-account-facts">
          <dt>Plan</dt>
          <dd>{onYearly ? 'Yearly' : 'Monthly'}</dd>

          <dt>Price</dt>
          <dd>
            {onYearly ? `A$${PRICE_AUD_YEARLY}/year` : `A$${PRICE_AUD}/month`}
          </dd>

          {cancelAtPeriodEnd && nextChargeDate ? (
            <>
              <dt>Access until</dt>
              <dd>{formatAuDate(nextChargeDate)}</dd>
            </>
          ) : nextChargeDate ? (
            <>
              <dt>{nextChargeLabel}</dt>
              <dd>{formatAuDate(nextChargeDate)}</dd>
            </>
          ) : null}
        </dl>

        {status === 'past_due' && (
          <p className="bb-account-error">
            We couldn&rsquo;t process your last payment. Update your card to
            keep your access.
          </p>
        )}

        <div className="bb-account-card-footer bb-account-card-footer-split">
          <p className="bb-account-note">
            {cancelAtPeriodEnd
              ? 'Your subscription is ending. Resume it from Settings.'
              : 'Cancel or resume from Settings.'}
          </p>
          <button
            type="button"
            className="bb-btn bb-btn-outline"
            onClick={openPortal}
            disabled={isPending}
          >
            {isPending ? 'Opening…' : 'Card, invoices & plan'}
          </button>
        </div>

        {error && <p className="bb-account-error">{error}</p>}
      </section>

      {/* Invoices. */}
      <section className="bb-account-card">
        <h2 className="bb-account-card-title">Invoices</h2>
        <p className="bb-account-card-help">
          Every payment, with a downloadable tax invoice.
        </p>
        <InvoiceTable invoices={invoices} />
      </section>
    </div>
  );
}