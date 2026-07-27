// lib/billing/copy.ts
//
// Every customer-facing billing claim and number, in one file.
//
// WHY THIS EXISTS: the audience is lawyers. A claim about data handling or tax
// that turns out to be untrue is worse than saying nothing at all — it is the
// exact thing this audience is trained to notice. Centralising the claims
// means there is one place to check them, and one place to update when the
// underlying fact changes.
//
// EACH FLAG BELOW IS FALSE UNTIL THE UNDERLYING FACT IS TRUE. Do not flip one
// because the copy reads better with it on.

/**
 * GST registration.
 *
 * FALSE until the ABN is registered for GST. Registration is only compulsory
 * above $75,000 turnover. Charging or advertising GST while unregistered is
 * unlawful, and a lawyer reading "incl. GST" on an invoice from an
 * unregistered supplier will notice.
 *
 * When this becomes true: set it, enable Stripe Tax, and make sure the Stripe
 * invoice template carries the ABN and a GST line.
 */
export const GST_REGISTERED = false;

/**
 * Australian data residency.
 *
 * FALSE while Supabase runs in ap-southeast-1 (Singapore). See
 * MIGRATION_RUNBOOK.md — flip this only once the Sydney migration is done and
 * verified, because for Australian lawyers this is a genuine professional
 * obligation question (APP 8, plus various law society guidance on offshore
 * storage of client material), not a marketing line.
 */
export const AU_DATA_RESIDENCY = false;

/** Monthly price, in whole dollars AUD. */
export const PRICE_AUD = 99;

/** Annual price, in whole dollars AUD. */
export const PRICE_AUD_YEARLY = 999;

/** Support address shown when something goes wrong with a payment. */
export const SUPPORT_EMAIL = 'osr9915@gmail.com';

/**
 * Discount on the annual plan, as a whole percentage.
 *
 * COMPUTED, never hardcoded. A "Save 20%" badge sitting next to prices that
 * actually save 16% is a misrepresentation — the sort of small, checkable
 * inaccuracy this audience notices, and the sort the ACCC treats as
 * misleading regardless of intent. Deriving it means the badge cannot drift
 * out of step with the numbers above.
 *
 * Rounded DOWN so the claim is never overstated.
 */
export function yearlySavingsPercent(): number {
  const fullYear = PRICE_AUD * 12;
  return Math.floor(((fullYear - PRICE_AUD_YEARLY) / fullYear) * 100);
}

/** Dollars saved per year on the annual plan. */
export function yearlySavingsAmount(): number {
  return PRICE_AUD * 12 - PRICE_AUD_YEARLY;
}

/** Annual price expressed per month, for like-for-like comparison. */
export function yearlyPerMonth(): string {
  const perMonth = PRICE_AUD_YEARLY / 12;
  return `A$${perMonth.toFixed(2)}`;
}

/**
 * Plan descriptions for the chooser.
 *
 * Both plans buy exactly the same product — the only difference is billing
 * frequency and price. There is deliberately no feature gating between them:
 * a lawyer choosing monthly should not get a worse tool, and an artificial
 * feature split to push people annual is the kind of thing this audience
 * reads as a tell.
 */
export interface PlanCopy {
  interval: 'month' | 'year';
  name: string;
  tagline: string;
  /** Big number, without the currency symbol. */
  amount: string;
  /** Sits beside the amount. */
  unit: string;
  /** Sits under the price. */
  detail: string;
  /** Gold badge, or null. */
  badge: string | null;
}

export function monthlyPlan(): PlanCopy {
  return {
    interval: 'month',
    name: 'Monthly',
    tagline: 'Month to month, cancel any time',
    amount: `A$${PRICE_AUD}`,
    unit: 'per month',
    detail: GST_REGISTERED
      ? 'Billed monthly, including GST'
      : 'Billed monthly',
    badge: null,
  };
}

export function yearlyPlan(): PlanCopy {
  return {
    interval: 'year',
    name: 'Yearly',
    tagline: `Two months free, effectively ${yearlyPerMonth()} a month`,
    amount: `A$${PRICE_AUD_YEARLY}`,
    unit: 'per year',
    detail: GST_REGISTERED
      ? `Billed annually, including GST — saves A$${yearlySavingsAmount()}`
      : `Billed annually — saves A$${yearlySavingsAmount()} a year`,
    badge: `Save ${yearlySavingsPercent()}%`,
  };
}

/**
 * What the subscription includes. Identical for both plans, by design.
 */
export const PLAN_FEATURES = [
  '~57,000 NSW judgments and the full High Court',
  'Every in-force NSW and Commonwealth Act, section by section',
  'Answers cited to the paragraph, with the passage shown',
  'Output shaped for how you practise',
  'Matters, files, and firm collaboration',
];

/**
 * Trust line shown under the plan chooser.
 *
 * Capped deliberately. Baymard's research on trust badges found that stacking
 * six or more actively REDUCES conversion: past a point the reassurance
 * itself reads as protesting too much. Each item is a fact we can stand
 * behind, and items drop out automatically when they stop being true.
 */
export function trustPoints(): string[] {
  const points = ['Card details go straight to Stripe'];
  if (AU_DATA_RESIDENCY) {
    points.push('Your data is stored in Australia');
  }
  points.push('We never train AI on your matters');
  return points;
}

/**
 * The things someone starting a card-required trial wants to know.
 *
 * Stating the charge date as a plain fact is the single highest-value piece
 * of copy on the page: it is what separates a trial from a subscription trap,
 * it materially reduces chargebacks (most of which come from surprise rather
 * than malice), and it is the direction Australian consumer law is moving —
 * subscription traps and hard-to-exit renewals are current ACCC compliance
 * priorities.
 */
export function trialTerms(
  chargeDate: string,
  trialDays: number,
  interval: 'month' | 'year',
): string[] {
  const amount = interval === 'year' ? PRICE_AUD_YEARLY : PRICE_AUD;
  const cadence = interval === 'year' ? 'a year' : 'a month';
  return [
    `Free for ${trialDays} days — nothing is charged today`,
    `Then A$${amount} ${cadence}, first charged on ${chargeDate}`,
    'We email you before that first charge',
    'Cancel any time from Settings — two clicks, no phone call',
  ];
}

/** Formats a date the way an Australian reader expects. */
export function formatAuDate(value: Date | string | null): string {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Money, for invoice rows. Stripe amounts are in cents. */
export function formatAuMoney(cents: number, currency = 'aud'): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}