// app/(app)/billing/_components/billing-client.tsx
//
// Client half of the billing page. ZERO inline styles — every rule comes from
// settings.css, which is what keeps this page and /settings identical.
//
// =============================================================================
// TWO FAMILIES, TWO INTERVALS
// =============================================================================
//
// A segmented control picks the family (Individual or Firm); two structurally
// identical cards below it pick the interval. Same sections in the same order,
// differing only in the numbers and the badge — that matching structure is
// what makes the cards the same height without any height rules, and it keeps
// doing it when the copy changes.
//
// Every plan buys exactly the same product. There is deliberately no feature
// gating between intervals, and none between families either: a firm seat is
// not a better seat than an individual one, it is the same seat bought in
// bulk. An artificial split to push people onto the annual or firm plan is the
// kind of thing this audience reads as a tell, and the discount is a good
// enough reason on its own.
//
// The saving is COMPUTED in lib/billing/copy.ts, never typed by hand — a
// "Save 20%" badge beside prices that actually save 16% is a
// misrepresentation, and a checkable one. Firm savings are computed at the
// CURRENT seat count, because past 20 seats the per-seat rate changes.
//
// FLOW: pick family → (firm only) set seats → pick interval → Continue to
// payment swaps the chooser for the embedded Stripe form in place. Nothing
// navigates.

'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createPortalSessionAction } from '../_actions';
import { EmbeddedCheckoutPanel } from './embedded-checkout-panel';
import { InvoiceTable } from './invoice-table';
import type { InvoiceRow } from '@/lib/billing/invoices';
import {
  PLAN_FEATURES,
  FIRM_EXTRAS,
  FIRM_MIN_SEATS,
  FIRM_MAX_SEATS,
  FIRM_PRICE_AUD,
  FIRM_PRICE_AUD_YEARLY,
  FIRM_VOLUME_PRICE_AUD,
  FIRM_VOLUME_PRICE_AUD_YEARLY,
  PRICE_AUD,
  PRICE_AUD_YEARLY,
  clampSeats,
  firmSeatPrice,
  firmTotal,
  formatAuDate,
  formatAuDollars,
  isFirmVolumeRate,
  plansFor,
  seatsToVolumeRate,
  trialTerms,
  trustPoints,
  type PlanCopy,
  type PlanFamily,
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
  firmAvailable: boolean;
  /**
   * Family and interval of the active subscription, resolved from its Stripe
   * price id on the SERVER. Resolving it there means the four price ids stay
   * out of the browser bundle.
   */
  activePlan: { family: PlanFamily; interval: 'month' | 'year' } | null;
}

/** Seats a firm chooser opens on — small enough to feel like a real starting point. */
const DEFAULT_SEATS = 3;

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
  firmAvailable,
  activePlan,
}: Props) {
  const router = useRouter();
  const [family, setFamily] = useState<PlanFamily>('individual');
  const [seats, setSeats] = useState(DEFAULT_SEATS);
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
    const isFirm = family === 'firm';
    const allPlans: PlanCopy[] = plansFor(family, seats);
    const plans = yearlyAvailable ? allPlans : allPlans.slice(0, 1);

    if (checkoutOpen) {
      const total = isFirm
        ? firmTotal(seats, interval)
        : interval === 'year'
          ? PRICE_AUD_YEARLY
          : PRICE_AUD;

      return (
        <div className="bb-account-body">
          <section className="bb-account-card bb-account-card-feature">
            <div className="bb-checkout-head">
              <div>
                <h2 className="bb-account-card-title">
                  {isFirm ? 'Firm' : 'Individual'} —{' '}
                  {interval === 'year' ? 'yearly' : 'monthly'}
                </h2>
                <p className="bb-account-card-help" style={{ margin: 0 }}>
                  {trialDays} days free, then {formatAuDollars(total)}
                  {isFirm ? ` for ${seats} people` : ''} on {chargeDate}.
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
                family={family}
                seats={isFirm ? seats : 1}
                onSubscribed={handleSubscribed}
              />
            </div>
          </section>
        </div>
      );
    }

    const toVolume = seatsToVolumeRate(seats);

    return (
      <div>
        {/* Family. Hidden entirely when firm prices aren't configured — an
            option that can't be bought is worse than no option. */}
        {firmAvailable && (
          <div
            className="bb-seg"
            role="radiogroup"
            aria-label="Who is this for?"
          >
            <button
              type="button"
              role="radio"
              aria-checked={!isFirm}
              className={`bb-seg-btn${!isFirm ? ' bb-seg-btn-active' : ''}`}
              onClick={() => setFamily('individual')}
            >
              Individual
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={isFirm}
              className={`bb-seg-btn${isFirm ? ' bb-seg-btn-active' : ''}`}
              onClick={() => setFamily('firm')}
            >
              Firm
            </button>
          </div>
        )}

        {/* Seats. Only meaningful for a firm. */}
        {isFirm && (
          <div className="bb-seats">
            <div className="bb-seats-row">
              <label className="bb-seats-label" htmlFor="bb-seats-input">
                How many people?
              </label>
              <div className="bb-stepper">
                <button
                  type="button"
                  className="bb-stepper-btn"
                  aria-label="Remove a person"
                  disabled={seats <= FIRM_MIN_SEATS}
                  onClick={() => setSeats((n) => clampSeats(n - 1))}
                >
                  −
                </button>
                <input
                  id="bb-seats-input"
                  className="bb-stepper-input"
                  type="number"
                  inputMode="numeric"
                  min={FIRM_MIN_SEATS}
                  max={FIRM_MAX_SEATS}
                  value={seats}
                  onChange={(e) => setSeats(clampSeats(Number(e.target.value)))}
                />
                <button
                  type="button"
                  className="bb-stepper-btn"
                  aria-label="Add a person"
                  disabled={seats >= FIRM_MAX_SEATS}
                  onClick={() => setSeats((n) => clampSeats(n + 1))}
                >
                  +
                </button>
              </div>
            </div>

            <p className="bb-seats-note">
              {isFirmVolumeRate(seats) ? (
                <>
                  Volume rate applied — every seat is A$
                  {firmSeatPrice(seats, interval)}{' '}
                  {interval === 'year' ? 'a year' : 'a month'}.
                </>
              ) : (
                <>
                  {toVolume} more {toVolume === 1 ? 'person' : 'people'} and
                  every seat drops to A$
                  {interval === 'year'
                    ? FIRM_VOLUME_PRICE_AUD_YEARLY
                    : FIRM_VOLUME_PRICE_AUD}{' '}
                  {interval === 'year' ? 'a year' : 'a month'}.
                </>
              )}
            </p>
          </div>
        )}

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
                  {isFirm &&
                    FIRM_EXTRAS.map((f) => (
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
            {trialTerms(chargeDate, trialDays, interval, family, seats).map(
              (t) => (
                <li key={t}>{t}</li>
              ),
            )}
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
  const onFirm = activePlan?.family === 'firm';
  const onYearly = activePlan?.interval === 'year';

  const planLabel = activePlan
    ? `${onFirm ? 'Firm' : 'Individual'} — ${onYearly ? 'yearly' : 'monthly'}`
    : 'Subscription';

  // Per-seat rate for a firm, because the seat count lives in Stripe rather
  // than in our subscription row — quoting a total we cannot verify would be
  // worse than pointing at the place that knows.
  const priceLabel = onFirm
    ? `From A$${onYearly ? FIRM_PRICE_AUD_YEARLY : FIRM_PRICE_AUD} per person, ${onYearly ? 'per year' : 'per month'}`
    : onYearly
      ? `A$${PRICE_AUD_YEARLY}/year`
      : `A$${PRICE_AUD}/month`;

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
          <dd>{planLabel}</dd>

          <dt>Price</dt>
          <dd>{priceLabel}</dd>

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
              : onFirm
                ? 'Add or remove people, and cancel or resume, from Settings.'
                : 'Cancel or resume from Settings.'}
          </p>
          <button
            type="button"
            className="bb-btn bb-btn-outline"
            onClick={openPortal}
            disabled={isPending}
          >
            {isPending
              ? 'Opening…'
              : onFirm
                ? 'Card, invoices, people & plan'
                : 'Card, invoices & plan'}
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
