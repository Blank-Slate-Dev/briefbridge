// scripts/pricing-selftest.ts
//
//   npx tsx scripts/pricing-selftest.ts
//
// Guards the pricing arithmetic in lib/billing/copy.ts. Run it after touching
// any price, the seat minimum, or the volume threshold.
//
// The three properties that matter most, and why:
//
//   1. VOLUME, NOT GRADUATED. A 25-seat firm must pay 25 x $59 = $1,475, not
//      20 x $79 + 5 x $59 = $1,875. The Stripe price must be created with
//      tiers_mode: 'volume' to match — if someone creates it as 'graduated',
//      this file still passes while the invoice silently disagrees with the
//      pricing page. See the tier shape in lib/stripe.ts.
//
//   2. SAVINGS ROUNDED DOWN. The "Save 15%" badge must never claim more than
//      the true saving. Overstating it is a misrepresentation the ACCC treats
//      as misleading regardless of intent, and a checkable one.
//
//   3. TRIAL TERMS QUOTE THE TOTAL. The line that says what the card will be
//      charged must show the firm's whole bill, not the per-seat rate.
//
import * as c from '@/lib/billing/copy';
let pass=0, fail=0;
const eq=(l:string,g:unknown,w:unknown)=>{const a=JSON.stringify(g),b=JSON.stringify(w);
  if(a===b){pass++;console.log(`  ok   ${l}  → ${a}`)}else{fail++;console.log(`  FAIL ${l}\n       got ${a}\n       want ${b}`)}};

console.log('--- tier boundary: base rate up to 20, volume from 21 ---');
eq('20 seats is base rate', c.isFirmVolumeRate(20), false);
eq('21 seats is volume rate', c.isFirmVolumeRate(21), true);
eq('seat price @20 /mo', c.firmSeatPrice(20,'month'), 79);
eq('seat price @21 /mo', c.firmSeatPrice(21,'month'), 59);
eq('seat price @20 /yr', c.firmSeatPrice(20,'year'), 799);
eq('seat price @21 /yr', c.firmSeatPrice(21,'year'), 599);

console.log('\n--- VOLUME tiering: all seats reprice (not graduated) ---');
eq('25 seats /mo total', c.firmTotal(25,'month'), 25*59);           // 1475, NOT 20*79+5*59=1875
eq('25 seats /yr total', c.firmTotal(25,'year'), 25*599);           // 14975
eq('20 seats /mo total', c.firmTotal(20,'month'), 20*79);           // 1580
eq('21 seats costs LESS than 20', c.firmTotal(21,'month') < c.firmTotal(20,'month'), true);

console.log('\n--- seat clamping (server + stepper share this) ---');
eq('clamp below min', c.clampSeats(1), c.FIRM_MIN_SEATS);
eq('clamp negative', c.clampSeats(-5), c.FIRM_MIN_SEATS);
eq('clamp NaN', c.clampSeats(NaN), c.FIRM_MIN_SEATS);
eq('clamp above max', c.clampSeats(99999), c.FIRM_MAX_SEATS);
eq('clamp fractional', c.clampSeats(7.9), 7);
eq('clamp in range', c.clampSeats(12), 12);

console.log('\n--- savings never overstated (rounded DOWN) ---');
eq('individual savings %', c.yearlySavingsPercent(), 15);
eq('individual savings $', c.yearlySavingsAmount(), 189);
eq('firm base savings %', c.firmYearlySavingsPercent(5), 15);
eq('firm volume savings %', c.firmYearlySavingsPercent(25), 15);
eq('firm savings $ @25', c.firmYearlySavingsAmount(25), 25*59*12 - 25*599);
// the badge must never claim more than the truth
const realIndiv = ((99*12-999)/(99*12))*100;
eq('individual badge <= true saving', c.yearlySavingsPercent() <= realIndiv, true);
const realVol = ((59*12-599)/(59*12))*100;
eq('volume badge <= true saving', c.firmYearlySavingsPercent(25) <= realVol, true);

console.log('\n--- nudge copy ---');
eq('seats to volume @3', c.seatsToVolumeRate(3), 18);
eq('seats to volume @20', c.seatsToVolumeRate(20), 1);
eq('seats to volume @21', c.seatsToVolumeRate(21), null);

console.log('\n--- trial terms quote the TOTAL for a firm, not per-seat ---');
const t = c.trialTerms('1 September 2026', 7, 'month', 'firm', 25);
eq('firm trial quotes total', t[1], 'Then A$1,475 for 25 people a month, first charged on 1 September 2026');
const ti = c.trialTerms('1 September 2026', 7, 'month');
eq('individual trial unchanged', ti[1], 'Then A$99 a month, first charged on 1 September 2026');

console.log('\n--- firm seat is cheaper than individual: min 2 closes the gap ---');
eq('firm base < individual', c.FIRM_PRICE_AUD < c.PRICE_AUD, true);
eq('min seats is 2', c.FIRM_MIN_SEATS, 2);
eq('cheapest firm purchase', c.firmTotal(c.FIRM_MIN_SEATS,'month'), 158);

console.log('\n--- plan cards ---');
eq('plansFor firm returns 2', c.plansFor('firm',25).length, 2);
eq('firm monthly amount @25', c.plansFor('firm',25)[0].amount, 'A$59');
eq('firm monthly unit', c.plansFor('firm',25)[0].unit, 'per person, per month');
eq('individual monthly amount', c.plansFor('individual',1)[0].amount, 'A$99');
eq('firm badge @25', c.plansFor('firm',25)[1].badge, 'Save 15%');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
