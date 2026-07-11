// Numeric tests of the calculation logic in sim.js — run with:  node test/sim.test.js
// No dependencies. Every expected value is worked out by hand from the 2026 rules.
const { aktieTax, bracketTax, sellForNet, drawdown, askDrawdown, simulate } = require('../sim.js');

const BASE = {
  initial: 100000, monthly: 0, horizon: 1, gross: 0.07, infl: 0,
  askTer: 0, askForex: 0, askTax: 0.17, askCeiling: 1e12, reg: 0,
  taxTer: 0, taxDiv: 0, divMode: 'cash', taxLow: 0.27, taxHigh: 0.42,
  threshold: 79400, threshold27: 79400,
  threshUsed: 0, married: false, liqYears: 1, redeposit: true, drawMode: 'years',
  harvest: false, feePct: 0, feeMin: 0, askFeePct: 0, askFeeMin: 0, msDepot: true, msAsk: true
};
const P = o => Object.assign({}, BASE, o);
const FLAT = () => 79400;   // threshold function for drawdown tests with reg = 0
const r2 = x => Math.round(x * 100) / 100;
let fails = 0;
function check(name, got, want, tol = 0.01) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: got ${r2(got)}, want ${r2(want)}`);
}

// T1: 1 year, lump sum, no costs. 7% p.a. via monthly compounding.
{
  const R = simulate(P({}));
  check('T1 ASK after tax', R.A_after, 107000 - 7000 * 0.17);
  check('T1 taxable account after tax', R.B_after, 107000 - 7000 * 0.27);
}

// T2: the FX cost is deductible in the mark-to-market tax base
// (deposits count gross: base = value - 100,000, not - 99,750)
{
  const R = simulate(P({ askForex: 0.0025 }));
  const v = 99750 * 1.07;
  check('T2 ASK tax (base against gross deposits)', R.A_tax, Math.max(0, v - 100000) * 0.17);
}

// T3: deposit headroom is measured against the 31 Dec value BEFORE the tax
// withdrawal (the tax is only taken in February), plus the tax itself, which
// may always be re-deposited (§ 9, stk. 2).
{
  // ceiling 100k, deposit 90k, 20% return: year-end v=108,000, tax 3,060.
  // Year-2 headroom = max(0, 100,000-108,000) + 3,060 = 3,060.
  const R = simulate(P({ askCeiling: 100000, initial: 90000, monthly: 300, horizon: 2, gross: 0.20 }));
  check('T3 overflow starts year 2 (3,600 offered > 3,060 headroom)', R.firstOverflow, 2, 0);
  const R2 = simulate(P({ askCeiling: 100000, initial: 90000, monthly: 255, horizon: 2, gross: 0.20 }));
  check('T3b no overflow (3,060 offered = headroom)', R2.firstOverflow === null ? 1 : 0, 1, 0);
}

// T4: drawdown — both strategies, flat threshold (reg = 0). gross = 0 keeps the
// position from growing during the sale years, so the slices stay hand-computable.
{
  const d1 = drawdown(1000000, 400000, P({ liqYears: 1, gross: 0 }), FLAT, 0);
  check('T4 lump-sum sale', d1.tax, 79400 * 0.27 + 520600 * 0.42);
  const d2 = drawdown(1000000, 400000, P({ drawMode: 'kink', gross: 0 }), FLAT, 0);
  check('T4 up-to-threshold tax', d2.tax, 600000 * 0.27);
  check('T4 up-to-threshold years', d2.years, 8, 0);
  const d3 = drawdown(1000000, 400000, P({ liqYears: 10, gross: 0 }), FLAT, 0);
  check('T4 spread over 10 years', d3.tax, 10 * 60000 * 0.27);
}

// T4b-e: the threshold during the sale years — used band, degenerate cases
{
  const d2 = drawdown(1000000, 920600, P({ liqYears: 1, gross: 0 }), FLAT, 79400);
  check('T4c band fully used -> all at high rate', d2.tax, 79400 * 0.42);
  const d3 = drawdown(1000000, 400000, P({ drawMode: 'kink', gross: 0, threshUsed: 39400 }), FLAT, 39400);
  check('T4d 40k free band per year -> 15 years', d3.years, 15, 0);
  const d4 = drawdown(1000000, 400000, P({ drawMode: 'kink', gross: 0, threshUsed: 100000 }), FLAT, 100000);
  check('T4e band never opens -> forced sale, all at 42%', d4.tax, 600000 * 0.42);
  check('T4e forced flag set', d4.forced ? 1 : 0, 1, 0);
  check('T4e kink window capped at 30 years', d4.years, 30, 0);
}

// T4g: a kink bucket with band slack spreads evenly over a given common window
// instead of exiting early. 100k (basis 90k), 10% p.a., window 2 years:
// year 1 sells 50,000 (gain 5,000 -> tax 1,350); the rest grows to 55,000
// (gain 10,000) and is sold in year 2 (tax 2,700). Both years fit the band.
{
  const d = drawdown(100000, 90000, P({ drawMode: 'kink', gross: 0.10 }), FLAT, 0, 2);
  check('T4g slack bucket spreads into the window', d.after, 48650 + 52300);
  check('T4g tax', d.tax, 1350 + 2700);
  check('T4g years', d.years, 2, 0);
  check('T4g not forced (band fits)', d.forced ? 1 : 0, 0, 0);
}

// T4f: with growth the remaining slices keep compounding and each year's sale
// is taxed on its own realised gain. 100k (basis 50k), 10% p.a., 2 years:
// year 1 sells 50,000 (gain 25,000 -> tax 6,750); the remaining 50,000 (basis
// 25,000) grows to 55,000; year 2 sells all (gain 30,000 -> tax 8,100).
{
  const d = drawdown(100000, 50000, P({ liqYears: 2, gross: 0.10 }), FLAT, 0);
  check('T4f growth during sale years: tax', d.tax, 6750 + 8100);
  check('T4f growth during sale years: withdrawals', d.after, 43250 + 46900);
  check('T4f years', d.years, 2, 0);
}

// T5: dividend bookkeeping. 1 year, 2% distribution, 0% return.
// The base is the holdings at the start of the year (here: the January lump sum).
{
  // cash: div=2,000, tax=540 -> v=99,460, basis=100,000+1,460 (net reinvested)
  const R = simulate(P({ gross: 0, taxDiv: 0.02 }));
  check('T5 cash dividend', R.B_after, 99460);
  // technical: value only drops by the tax (funded by selling), basis is stepped
  // up gross minus the proportional cost basis of the shares sold
  const R2 = simulate(P({ gross: 0, taxDiv: 0.02, divMode: 'tech' }));
  check('T5b technical dividend', R2.B_after, 99460);
}

// T5c: entitlement — contributions after January get no dividend in their first
// year (the funds' ex-dates are Feb-Apr), so only the January purchase counts.
{
  const R = simulate(P({ initial: 0, monthly: 1000, gross: 0, taxDiv: 0.02 }));
  check('T5c dividend on January holdings only', R.B_tax, 1000 * 0.02 * 0.27);
}

// T6: in up-to-threshold mode (everything ends at 27%) a larger distribution must
// be a pure drag — same tax, just earlier. (In a lump-sum sale it can legitimately
// help, because the forced 27%-band realisation steps up basis against a 42% final sale.)
{
  const D = { initial: 100000, monthly: 4000, horizon: 20, gross: 0.07, infl: 0.02,
    askTer: 0.0007, askForex: 0.0025, askCeiling: 174200, reg: 0.02, threshold27: 87100,
    taxTer: 0.003, feePct: 0.001, feeMin: 25, askFeePct: 0.0015, askFeeMin: 25, drawMode: 'kink' };
  const b = d => simulate(P(Object.assign({}, D, { taxDiv: d }))).B_after;
  check('T6 monotonically decreasing in distribution', (b(0.01) > b(0.02) && b(0.02) > b(0.03)) ? 1 : 0, 1, 0);
}

// T7: married doubles both the ceiling and the progression threshold
{
  const R1 = simulate(P({ askCeiling: 100000, initial: 250000, horizon: 1, married: false }));
  const R2 = simulate(P({ askCeiling: 100000, initial: 250000, horizon: 1, married: true }));
  check('T7 double ceiling', R2.askFinal, 2 * R1.askFinal, 1);
}

// T8: "band used by other income" pushes the dividend tax into the high rate
{
  check('T8 low band', simulate(P({ gross: 0, taxDiv: 0.02 })).B_tax, 2000 * 0.27);
  check('T8 high band', simulate(P({ gross: 0, taxDiv: 0.02, threshUsed: 200000 })).B_tax, 2000 * 0.42);
}

// T9: refill toggle — when off, nothing is sold from the taxable account
{
  const o = { askCeiling: 100000, initial: 200000, horizon: 5, gross: 0.07, feePct: 0.001, feeMin: 25 };
  const on  = simulate(P(Object.assign({}, o, { redeposit: true })));
  const off = simulate(P(Object.assign({}, o, { redeposit: false })));
  check('T9 no funding-trade fees when refill is off', off.A_fee < on.A_fee ? 1 : 0, 1, 0);
}

// T9b: the January refill is grossed up so the net deposit exactly fills the gap.
// Ceiling 100k, lump sum 190k, 10% p.a., no fees/FX: year 1 ends ask=108,300
// (tax 1,700), so year-2 headroom is exactly the re-depositable 1,700. The sale
// from the depot (gain fraction 9/99) is grossed up: X = 1,700/(1 - 0.27*9/99)
// = 1,742.77, tax 42.77 — and the ASK receives exactly 1,700, ending the year
// at (108,300+1,700)*1.1 - tax on 11,000 = 119,130.
{
  const R = simulate(P({ askCeiling: 100000, initial: 190000, horizon: 2, gross: 0.10 }));
  // ov after the January sale: 99,000-1,742.77=97,257.23 grows to 106,982.95
  // (basis 90,000-1,584.34=88,415.66); final sale gain 18,567.29 -> tax 5,013.17
  check('T9b A_after (ASK full again + depot remainder)', R.A_after, 119130 + 106982.95 - 5013.17, 0.5);
  check('T9b total tax on strategy A', R.A_tax, 1700 + 1870 + 42.77 + 5013.17, 0.5);
}

// T10: the final ASK sale pays the ASK trading fee (and then FX)
{
  const R = simulate(P({ feePct: 0.001, feeMin: 25, askFeePct: 0.001, askFeeMin: 25 }));
  check('T10 A after trading fee', R.A_after, 105810 - 105.81);
}

// T10b: the ASK stays invested during a spread sale and keeps paying 17% lager.
// 100k, 10% p.a., 2 sale years: year 1 ends 110,000 - 1,700 = 108,300; sell half
// (54,150); rest grows to 59,565, pays 17% of 5,415 = 920.55, sells 58,644.45.
{
  const R = simulate(P({ horizon: 1, liqYears: 2, gross: 0.10 }));
  check('T10b ASK parallel drawdown', R.A_after, 54150 + 58644.45, 0.1);
}

// T11: no NaN at edge-case inputs
{
  for (const o of [{ gross: 0 }, { initial: 0, monthly: 0 }, { askCeiling: 0 }, { taxDiv: 0.5 },
                   { infl: 0.15, horizon: 40 }, { horizon: 1, drawMode: 'kink' },
                   { threshUsed: 1e9 }, { reg: 0.1, horizon: 40 }, { threshold27: 0 },
                   { liqYears: 40, horizon: 2 }, { gross: 0, taxTer: 0.02, horizon: 30 }]) {
    const R = simulate(P(o));
    if (!isFinite(R.A_after) || !isFinite(R.B_after) || !isFinite(R.A_real) || !isFinite(R.B_real)) {
      console.log('T11 NaN for', JSON.stringify(o)); fails++;
    }
  }
  console.log('T11 edge cases ok (no NaN lines above)');
}

// T12: harvesting is skipped in the sale year (it would only add fees)
{
  const R1 = simulate(P({ horizon: 1, gross: 0.07, feePct: 0.001, feeMin: 25, harvest: true }));
  check('T12 1 year with harvest = only the final sale fee', R1.B_fee, Math.max(0.001 * 107000, 25), 1);
}

// T13: månedsopsparing — buy-side kurtage per bucket, each with its own schedule
{
  const o = { initial: 0, monthly: 1000, horizon: 1, gross: 0,
              feePct: 0.001, feeMin: 25, askFeePct: 0.001, askFeeMin: 25 };
  // no månedsopsparing anywhere: every 1,000 kr buy pays the 25 kr minimum
  const R = simulate(P(Object.assign({}, o, { msAsk: false, msDepot: false })));
  check('T13 ASK after (12x25 buy fees + 25 sale fee)', R.A_after, 12000 - 300 - 25);
  check('T13 depot after (same)', R.B_after, 12000 - 300 - 25);
  // månedsopsparing on the taxable account only (the default UI setting)
  const R2 = simulate(P(Object.assign({}, o, { msAsk: false, msDepot: true })));
  check('T13b depot buys free, ASK buys pay', R2.B_after - R2.A_after, 300, 0.01);
}

// T13c: the two markets have separate schedules — ASK minimum 30, depot minimum 25
{
  const R = simulate(P({ initial: 0, monthly: 1000, horizon: 1, gross: 0,
                         feePct: 0, feeMin: 25, askFeePct: 0, askFeeMin: 30,
                         msAsk: false, msDepot: false }));
  check('T13c ASK pays its own minimum', R.A_after, 12000 - 12 * 30 - 30);
  check('T13c depot pays its own minimum', R.B_after, 12000 - 12 * 25 - 25);
}

// T14: the purchase fee is deductible — via the cost basis in the taxable account,
// via the value-minus-gross-deposits base in the ASK. The depot's final sale
// also deducts its 25 kr sale fee from the disposal sum.
{
  const R = simulate(P({ initial: 10000, monthly: 0, gross: 0.07, feePct: 0, feeMin: 25,
                         askFeePct: 0, askFeeMin: 25, msAsk: false, msDepot: false }));
  const v = 9975 * 1.07;
  check('T14 ASK tax base net of buy fee', R.A_tax, (v - 10000) * 0.17);
  check('T14 depot gain measured against gross basis', R.B_tax, (v - 10000 - 25) * 0.27);
}

// T15: the 2027 threshold uplift is its own parameter. 1M lump sum, 8.5%
// cash distribution, 0% return: year 1 (2026) taxes 85,000 against 79,400
// (23,790); year 2 taxes 8.5% of 976,210 = 82,977.85 against 87,100 — all at
// the low rate (22,404.02). The final sale has no gain (basis was stepped up).
{
  const R = simulate(P({ initial: 1000000, horizon: 2, gross: 0, taxDiv: 0.085, threshold27: 87100 }));
  check('T15 2027 uplift applies from year 2', R.B_tax, 23790 + 22404.02, 0.1);
}

// T16: real mode deflates every withdrawal by its own payout year.
// 0% return and inflation 10%, 2 sale years, no tax (basis = value):
// nominal 50,000+50,000; real 50,000/1.1 + 50,000/1.21.
{
  const R = simulate(P({ gross: 0, infl: 0.10, liqYears: 2 }));
  check('T16 nominal sum of withdrawals', R.B_after, 100000);
  check('T16 per-year deflation', R.B_real, 50000 / 1.1 + 50000 / 1.21, 0.1);
}

// T17: in kink mode the slower strategy defines a common window — both
// strategies deliver their money over the same years (no timing asymmetry),
// and the window never exceeds the 30-year cap.
{
  const D = { initial: 100000, monthly: 4000, horizon: 20, gross: 0.07, infl: 0.02,
    askTer: 0.0007, askForex: 0.0025, askCeiling: 174200, reg: 0.02, threshold27: 87100,
    taxTer: 0.003, taxDiv: 0.014, divMode: 'tech', feePct: 0.001, feeMin: 25,
    askFeePct: 0.0015, askFeeMin: 25, msAsk: false, drawMode: 'kink' };
  const R = simulate(P(D));
  check('T17 common drawdown window', R.A_years, R.B_years, 0);
  const R2 = simulate(P(Object.assign({}, D, { reg: 0 })));
  check('T17b capped window when the band cannot keep up', Math.max(R2.A_years, R2.B_years), 30, 0);
  check('T17b forced flag reported', R2.B_forced ? 1 : 0, 1, 0);
}

// T18: the chart data for the drawdown wedge. The curves show wealth if
// everything were sold in the given year; the wedge's wealth path (paid out +
// remainder sold now) starts where that curve ends (within one band-year of
// abort headroom) and ends exactly at the plan's total, with the payout path
// converging on the same number.
{
  const R = simulate(P({ liqYears: 10, gross: 0.07, infl: 0.02, horizon: 2 }));
  check('T18 path length = drawdown years', R.drawSeries.length, 10, 0);
  const first = R.drawSeries[0], e = R.drawSeries[R.drawSeries.length - 1];
  const instant = R.series[R.series.length - 1].A;
  check('T18 wealth path starts near the instant-sale curve',
        Math.abs(first.wealthA - instant) < 0.03 * instant ? 1 : 0, 1, 0);
  check('T18 wealth path ends at the plan total', e.wealthA, R.A_after, 0.5);
  check('T18 payouts converge on the total', e.cashA, R.A_after, 0.5);
  check('T18 real payouts converge too', e.cashAreal, R.A_real, 0.5);
  // with a 1-year sale, the instant-sale curve's endpoint IS the headline
  const R1 = simulate(P({}));
  check('T18b 1-year sale: curve end = headline', R1.series[R1.series.length - 1].A, R1.A_after);
}

// T19: selling costs reduce the disposal sum. 10,000 grows to 10,700; the final
// sale pays the 25 kr minimum commission, so the taxable gain is 675, not 700.
{
  const R = simulate(P({ initial: 10000, gross: 0.07, feeMin: 25 }));
  check('T19 sale fee deducted from the taxable gain', R.B_tax, 675 * 0.27);
  check('T19 net proceeds', R.B_after, 10700 - 675 * 0.27 - 25);
}

// T20: the harvest round trip. 100,000 grows to 110,000 in year 1; gain 10,000
// fits the band, so the whole position turns over (notional 110,000).
// Sell fee 110 -> taxable gain 9,890, tax 2,670.30. The 107,219.70 that remains
// is rebought, paying a 107.22 buy fee that joins the new acquisition cost:
// value 107,112.48, basis 107,219.70 (exactly one buy fee above the value).
// Year 2: value grows to 117,823.73, gain 10,604.03; the final sale pays
// 117.82 in commission -> taxable gain 10,486.20, tax 2,831.28.
{
  const R = simulate(P({ initial: 100000, horizon: 2, gross: 0.10, harvest: true,
                         feePct: 0.001, feeMin: 25 }));
  check('T20 harvest + final-sale tax', R.B_tax, 2670.30 + 2831.28);
  check('T20 fees (sell + buy + final sale)', R.B_fee, 110 + 107.22 + 117.82);
  check('T20 net proceeds', R.B_after, 114874.63);
}

console.log(fails ? `\n${fails} FAILURES` : '\nALL TESTS PASS');
process.exit(fails ? 1 : 0);
