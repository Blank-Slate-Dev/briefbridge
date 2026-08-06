// app/_components/pricing-section.tsx
//
// Public pricing. Rendered on the homepage at #pricing.
//
// Client component only because of the Individual/Firm control — everything
// else here is static. All numbers come from lib/billing/copy.ts, the same
// module the checkout reads, so the price a barrister sees on the homepage and
// the price their card is charged cannot drift apart. That matters more than
// usual with this audience: a pricing page that disagrees with the invoice is
// exactly the discrepancy they are trained to find.
//
// The firm view deliberately shows BOTH tiers side by side rather than hiding
// the volume rate behind a "contact us". A firm working out whether to move
// twenty-five people onto this should be able to do the arithmetic on the page
// without talking to anyone.

'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  FIRM_BASE_RATE_MAX_SEATS,
  FIRM_MIN_SEATS,
  FIRM_PRICE_AUD,
  FIRM_PRICE_AUD_YEARLY,
  FIRM_VOLUME_PRICE_AUD,
  FIRM_VOLUME_PRICE_AUD_YEARLY,
  GST_REGISTERED,
  PLAN_FEATURES,
  FIRM_EXTRAS,
  PRICE_AUD,
  PRICE_AUD_YEARLY,
  savingsPercent,
  type PlanFamily,
} from '@/lib/billing/copy';

const TRIAL_DAYS = 7;

interface Tier {
  key: string;
  label: string;
  sublabel: string;
  monthly: number;
  yearly: number;
  unit: string;
  badge: string | null;
}

const INDIVIDUAL_TIERS: Tier[] = [
  {
    key: 'individual',
    label: 'Individual',
    sublabel: 'One practitioner',
    monthly: PRICE_AUD,
    yearly: PRICE_AUD_YEARLY,
    unit: 'per month',
    badge: null,
  },
];

const FIRM_TIERS: Tier[] = [
  {
    key: 'firm-base',
    label: `${FIRM_MIN_SEATS}–${FIRM_BASE_RATE_MAX_SEATS} people`,
    sublabel: 'Chambers floors and small firms',
    monthly: FIRM_PRICE_AUD,
    yearly: FIRM_PRICE_AUD_YEARLY,
    unit: 'per person, per month',
    badge: null,
  },
  {
    key: 'firm-volume',
    label: `${FIRM_BASE_RATE_MAX_SEATS + 1}+ people`,
    sublabel: 'Every seat drops to this rate',
    monthly: FIRM_VOLUME_PRICE_AUD,
    yearly: FIRM_VOLUME_PRICE_AUD_YEARLY,
    unit: 'per person, per month',
    badge: 'Best value',
  },
];

export function PricingSection() {
  const [family, setFamily] = useState<PlanFamily>('individual');
  const isFirm = family === 'firm';
  const tiers = isFirm ? FIRM_TIERS : INDIVIDUAL_TIERS;

  return (
    <section className="bb-section" id="pricing">
      <div className="bb-section-eyebrow">Pricing</div>
      <h2 className="bb-section-title">
        One price. <em>The whole corpus.</em>
      </h2>
      <p className="bb-section-sub">
        Every plan includes everything. No research credits, no per-search
        charges, no feature held back for a higher tier.
      </p>

      <div className="bb-pricing-switch" role="radiogroup" aria-label="Who is this for?">
        <button
          type="button"
          role="radio"
          aria-checked={!isFirm}
          className={`bb-pricing-switch-btn${!isFirm ? ' bb-pricing-switch-btn-active' : ''}`}
          onClick={() => setFamily('individual')}
        >
          Individual
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={isFirm}
          className={`bb-pricing-switch-btn${isFirm ? ' bb-pricing-switch-btn-active' : ''}`}
          onClick={() => setFamily('firm')}
        >
          Firm
        </button>
      </div>

      <div
        className={`bb-price-grid${isFirm ? ' bb-price-grid-two' : ' bb-price-grid-one'}`}
      >
        {tiers.map((tier) => (
          <div key={tier.key} className="bb-price-card">
            {tier.badge && <span className="bb-price-badge">{tier.badge}</span>}

            <h3 className="bb-price-name">{tier.label}</h3>
            <p className="bb-price-sub">{tier.sublabel}</p>

            <div className="bb-price-figure">
              <span className="bb-price-currency">A$</span>
              <span className="bb-price-amount">{tier.monthly}</span>
              <span className="bb-price-unit">{tier.unit}</span>
            </div>

            <p className="bb-price-annual">
              or A${tier.yearly}{' '}
              {isFirm ? 'per person, per year' : 'a year'} — save{' '}
              {savingsPercent(tier.monthly, tier.yearly)}%
            </p>

            <Link href="/login" className="bb-btn bb-btn-primary bb-price-cta">
              Start {TRIAL_DAYS}-day free trial
            </Link>
          </div>
        ))}
      </div>

      <div className="bb-price-includes">
        <h3 className="bb-price-includes-title">Every plan includes</h3>
        <ul className="bb-price-features">
          {PLAN_FEATURES.map((f) => (
            <li key={f}>{f}</li>
          ))}
          {isFirm && FIRM_EXTRAS.map((f) => <li key={f}>{f}</li>)}
        </ul>
        <p className="bb-price-note">
          {TRIAL_DAYS}-day free trial, card required, cancel any time from
          Settings.{' '}
          {isFirm
            ? `Firm plans start at ${FIRM_MIN_SEATS} people. Past ${FIRM_BASE_RATE_MAX_SEATS}, every seat moves to the lower rate — not just the extra ones.`
            : 'Prices in Australian dollars.'}
          {GST_REGISTERED ? ' Prices include GST.' : ''}
        </p>
      </div>
    </section>
  );
}
