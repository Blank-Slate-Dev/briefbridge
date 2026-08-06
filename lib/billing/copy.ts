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
 *
 * NOTE: a 25-seat firm on the annual plan is A$14,975 a year. Two of those and
 * the $75,000 GST registration threshold is in sight — this flag now has a
 * plausible path to needing to change, where before it did not.
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

/**
 * Support address shown when something goes wrong with a payment.
 *
 * On briefbridge.ai with SPF, DKIM and DMARC all passing, so a reply from a
 * customer actually arrives. Do not put a free webmail address here: the one
 * moment a lawyer sees this string is the moment their card has just failed,
 * which is the worst possible time to look like a side project.
 */
export const SUPPORT_EMAIL = 'oakley@briefbridge.ai';

/* ==================================================================== */
/* Plan families                                                        */
/* ==================================================================== */

export type PlanFamily = 'individual' | 'firm';
export type BillingInterval = 'month' | 'year';

/* ---------------------------- Individual --------------------------- */

/** Monthly price, in whole dollars AUD. */
export const PRICE_AUD = 99;

/** Annual price, in whole dollars AUD. */
export const PRICE_AUD_YEARLY = 999;

/* ------------------------------- Firm ------------------------------ */
//
// Per seat, per period. Firms buy the same product — the discount is for
// volume, not for a better tool.

/** Firm base rate, per seat per month. */
export const FIRM_PRICE_AUD = 79;

/** Firm base rate, per seat per year. */
export const FIRM_PRICE_AUD_YEARLY = 799;

/** Firm volume rate, per seat per month, once past the threshold. */
export const FIRM_VOLUME_PRICE_AUD = 59;

/** Firm volume rate, per seat per year, once past the threshold. */
export const FIRM_VOLUME_PRICE_AUD_YEARLY = 599;

/**
 * Seat count at which EVERY seat reprices to the volume rate.
 *
 * The break is at 21 seats, i.e. "over 20". A 20-seat firm pays the base rate
 * on all 20; a 21-seat firm pays the volume rate on all 21 — Stripe volume
 * tiering, not graduated. This is the reading a firm administrator takes from
 * "drops to $59 each head", and where the two readings diverge the customer's
 * reading is the one that has to be right.
 *
 * Encoded as the last seat count that pays the BASE rate, which is also the
 * `up_to` value on the first Stripe tier — one number, no off-by-one between
 * our arithmetic and Stripe's.
 */
export const FIRM_BASE_RATE_MAX_SEATS = 20;

/**
 * Minimum seats on a firm plan.
 *
 * A firm seat ($79) is cheaper than an individual seat ($99), so a one-seat
 * firm plan would just be the individual plan at a discount. Requiring two
 * seats keeps each plan meaning what it says. Enforced server-side in
 * createEmbeddedCheckoutAction, not merely in the stepper UI.
 */
export const FIRM_MIN_SEATS = 2;

/**
 * Upper bound on seats at self-serve checkout.
 *
 * Not a real limit on firm size — a firm needing more than this is a
 * conversation, not a checkout. It stops a fat finger or a tampered request
 * from creating a A$300k subscription.
 */
export const FIRM_MAX_SEATS = 250;

/** True once the seat count earns the volume rate. */
export function isFirmVolumeRate(seats: number): boolean {
  return seats > FIRM_BASE_RATE_MAX_SEATS;
}

/** Per-seat price for a given seat count and interval, in whole dollars. */
export function firmSeatPrice(seats: number, interval: BillingInterval): number {
  const volume = isFirmVolumeRate(seats);
  if (interval === 'year') {
    return volume ? FIRM_VOLUME_PRICE_AUD_YEARLY : FIRM_PRICE_AUD_YEARLY;
  }
  return volume ? FIRM_VOLUME_PRICE_AUD : FIRM_PRICE_AUD;
}

/** Total for a firm subscription, in whole dollars. */
export function firmTotal(seats: number, interval: BillingInterval): number {
  return firmSeatPrice(seats, interval) * seats;
}

/**
 * Clamps a seat count to what we will actually sell.
 *
 * Used by both the stepper and the server action, so the UI can never offer a
 * number the server would reject.
 */
export function clampSeats(seats: number): number {
  if (!Number.isFinite(seats)) return FIRM_MIN_SEATS;
  return Math.min(FIRM_MAX_SEATS, Math.max(FIRM_MIN_SEATS, Math.floor(seats)));
}

/**
 * Seats still needed to reach the volume rate, or null if already there.
 *
 * Shown as a nudge on the stepper. Stated as a fact, never as pressure.
 */
export function seatsToVolumeRate(seats: number): number | null {
  if (isFirmVolumeRate(seats)) return null;
  return FIRM_BASE_RATE_MAX_SEATS + 1 - seats;
}

/* ==================================================================== */
/* Savings — COMPUTED, never hardcoded                                  */
/* ==================================================================== */

/**
 * Annual saving as a whole percentage, for any monthly/yearly pair.
 *
 * A "Save 20%" badge sitting next to prices that actually save 16% is a
 * misrepresentation — the sort of small, checkable inaccuracy this audience
 * notices, and the sort the ACCC treats as misleading regardless of intent.
 * Deriving it means the badge cannot drift out of step with the numbers.
 *
 * Rounded DOWN so the claim is never overstated.
 */
export function savingsPercent(monthly: number, yearly: number): number {
  const fullYear = monthly * 12;
  if (fullYear <= 0) return 0;
  return Math.floor(((fullYear - yearly) / fullYear) * 100);
}

/** Discount on the individual annual plan, as a whole percentage. */
export function yearlySavingsPercent(): number {
  return savingsPercent(PRICE_AUD, PRICE_AUD_YEARLY);
}

/** Dollars saved per year on the individual annual plan. */
export function yearlySavingsAmount(): number {
  return PRICE_AUD * 12 - PRICE_AUD_YEARLY;
}

/** Individual annual price expressed per month, for like-for-like comparison. */
export function yearlyPerMonth(): string {
  const perMonth = PRICE_AUD_YEARLY / 12;
  return `A$${perMonth.toFixed(2)}`;
}

/**
 * Firm annual saving at a given seat count.
 *
 * Depends on seats because the per-seat rate does. Both tiers happen to round
 * to the same percentage today, but computing it per seat count means that
 * stays true if either number moves.
 */
export function firmYearlySavingsPercent(seats: number): number {
  return savingsPercent(
    firmSeatPrice(seats, 'month'),
    firmSeatPrice(seats, 'year'),
  );
}

/** Dollars a firm saves per year by paying annually, at a given seat count. */
export function firmYearlySavingsAmount(seats: number): number {
  return firmTotal(seats, 'month') * 12 - firmTotal(seats, 'year');
}

/* ==================================================================== */
/* Plan chooser copy                                                    */
/* ==================================================================== */

/**
 * Plan descriptions for the chooser.
 *
 * Within a family, both intervals buy exactly the same product — the only
 * difference is billing frequency and price. There is deliberately no feature
 * gating between them: a lawyer choosing monthly should not get a worse tool,
 * and an artificial feature split to push people annual is the kind of thing
 * this audience reads as a tell.
 *
 * The same holds ACROSS families. A firm seat is not a better seat than an
 * individual one; it is the same seat, bought in bulk.
 */
export interface PlanCopy {
  interval: BillingInterval;
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

export function firmMonthlyPlan(seats: number): PlanCopy {
  const perSeat = firmSeatPrice(seats, 'month');
  return {
    interval: 'month',
    name: 'Monthly',
    tagline: 'Month to month, cancel any time',
    amount: `A$${perSeat}`,
    unit: 'per person, per month',
    detail: GST_REGISTERED
      ? `A$${firmTotal(seats, 'month')} a month for ${seats}, including GST`
      : `A$${firmTotal(seats, 'month')} a month for ${seats} people`,
    badge: null,
  };
}

export function firmYearlyPlan(seats: number): PlanCopy {
  const perSeat = firmSeatPrice(seats, 'year');
  return {
    interval: 'year',
    name: 'Yearly',
    tagline: `Effectively A$${(perSeat / 12).toFixed(2)} per person, per month`,
    amount: `A$${perSeat}`,
    unit: 'per person, per year',
    detail: GST_REGISTERED
      ? `A$${firmTotal(seats, 'year')} a year for ${seats}, including GST`
      : `A$${firmTotal(seats, 'year')} a year for ${seats} — saves A$${firmYearlySavingsAmount(seats)}`,
    badge: `Save ${firmYearlySavingsPercent(seats)}%`,
  };
}

/** The right pair of plan cards for a family and seat count. */
export function plansFor(family: PlanFamily, seats: number): PlanCopy[] {
  return family === 'firm'
    ? [firmMonthlyPlan(seats), firmYearlyPlan(seats)]
    : [monthlyPlan(), yearlyPlan()];
}

/**
 * What the subscription includes. Identical across families and intervals,
 * by design — see the note on PlanCopy.
 */
export const PLAN_FEATURES = [
  '~57,000 NSW judgments and the full High Court',
  'Every in-force NSW and Commonwealth Act, section by section',
  'Answers cited to the paragraph, with the passage shown',
  'Output shaped for how you practise',
  'Matters, files, and firm collaboration',
];

/** The handful of things a firm gets that a solo practitioner does not. */
export const FIRM_EXTRAS = [
  'Shared matters across your whole team',
  'One invoice, one renewal date',
  'Add or remove people at any time',
];

/* ==================================================================== */
/* Trust and trial terms                                                */
/* ==================================================================== */

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
 *
 * For a firm the figure quoted is the TOTAL, not the per-seat rate. Quoting
 * A$79 to someone whose card is about to be charged A$1,975 would be the
 * single most damaging sentence on the page.
 */
export function trialTerms(
  chargeDate: string,
  trialDays: number,
  interval: BillingInterval,
  family: PlanFamily = 'individual',
  seats = 1,
): string[] {
  const amount =
    family === 'firm'
      ? firmTotal(seats, interval)
      : interval === 'year'
        ? PRICE_AUD_YEARLY
        : PRICE_AUD;
  const cadence = interval === 'year' ? 'a year' : 'a month';
  const forSeats = family === 'firm' ? ` for ${seats} people` : '';
  // Thousands separators matter here: a firm annual total runs to five
  // figures, and "A$14975" is harder to read correctly than "A$14,975" on the
  // one line of copy that states what the card will be charged.
  const shown = formatAuDollars(amount);

  return [
    `Free for ${trialDays} days — nothing is charged today`,
    `Then ${shown}${forSeats} ${cadence}, first charged on ${chargeDate}`,
    'We email you before that first charge',
    'Cancel any time from Settings — two clicks, no phone call',
  ];
}

/* ==================================================================== */
/* Formatting                                                           */
/* ==================================================================== */

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

/**
 * Whole dollars with thousands separators, for firm totals.
 *
 * Prefixes "A$" by hand rather than using style: 'currency'. Intl renders AUD
 * in an en-AU locale as a bare "$1,475" — correct for an Australian reader in
 * isolation, but every other price on these pages is written "A$99", and a
 * page that switches between "$" and "A$" invites the question of whether one
 * of them is US dollars. That question is not one you want a prospective
 * customer asking on the pricing page.
 */
export function formatAuDollars(amount: number): string {
  const n = new Intl.NumberFormat('en-AU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
  return `A$${n}`;
}
