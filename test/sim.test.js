// Numeric tests of the calculation logic in sim.js — run with:  node test/sim.test.js
// No dependencies. Every expected value is worked out by hand from the 2026 rules.
const { aktieTax, bracketTax, drawdown, simulate } = require('../sim.js');

const BASE = {
  initial: 100000, monthly: 0, horizon: 1, gross: 0.07, infl: 0,
  askTer: 0, askForex: 0, askTax: 0.17, askCeiling: 1e12, reg: 0,
  taxTer: 0, taxDiv: 0, divMode: 'cash', taxLow: 0.27, taxHigh: 0.42, threshold: 79400,
  threshUsed: 0, married: false, liqYears: 1, redeposit: true, drawMode: 'years',
  harvest: false, feePct: 0, feeMin: 0, msDepot: true, msAsk: true
};
const P = o => Object.assign({}, BASE, o);
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

// T4: drawdown — both strategies, flat threshold (reg = 0)
{
  const d1 = drawdown(1000000, 400000, P({ liqYears: 1 }), 79400, 0);
  check('T4 lump-sum sale', d1.tax, 79400 * 0.27 + 520600 * 0.42);
  const d2 = drawdown(1000000, 400000, P({ drawMode: 'kink' }), 79400, 0);
  check('T4 up-to-threshold tax', d2.tax, 600000 * 0.27);
  check('T4 up-to-threshold years', d2.years, 8, 0);
  const d3 = drawdown(1000000, 400000, P({ liqYears: 10 }), 79400, 0);
  check('T4 spread over 10 years', d3.tax, 10 * 60000 * 0.27);
}

// T4b-e: the threshold during the sale years — adjustment, used band, degenerate cases
{
  const d2 = drawdown(1000000, 920600, P({ liqYears: 1 }), 79400, 79400);
  check('T4c band fully used -> all at high rate', d2.tax, 79400 * 0.42);
  const d3 = drawdown(1000000, 400000, P({ drawMode: 'kink', threshUsed: 39400 }), 79400, 39400);
  check('T4d 40k free band per year -> 15 years', d3.years, 15, 0);
  const d4 = drawdown(1000000, 400000, P({ drawMode: 'kink', threshUsed: 100000 }), 79400, 100000);
  check('T4e band never opens -> all at 42%', d4.tax, 600000 * 0.42);
}

// T5: dividend bookkeeping. 1 year, 2% distribution, 0% return.
{
  // cash: div=2,000, tax=540 -> v=99,460, basis=100,000+1,460 (net reinvested)
  const R = simulate(P({ gross: 0, taxDiv: 0.02 }));
  check('T5 cash dividend', R.B_after, 99460);
  // technical: value only drops by the tax (funded by selling), basis is stepped
  // up gross minus the proportional cost basis of the shares sold
  const R2 = simulate(P({ gross: 0, taxDiv: 0.02, divMode: 'tech' }));
  check('T5b technical dividend', R2.B_after, 99460);
}

// T6: in up-to-threshold mode (everything ends at 27%) a larger distribution must
// be a pure drag — same tax, just earlier. (In a lump-sum sale it can legitimately
// help, because the forced 27%-band realisation steps up basis against a 42% final sale.)
{
  const D = { initial: 100000, monthly: 4000, horizon: 20, gross: 0.07, infl: 0.02,
    askTer: 0.0007, askForex: 0.0025, askCeiling: 174200, reg: 0.02,
    taxTer: 0.003, feePct: 0.001, feeMin: 25, drawMode: 'kink' };
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

// T10: the final ASK sale pays a trading fee (and then FX)
{
  const R = simulate(P({ feePct: 0.001, feeMin: 25 }));
  check('T10 A after trading fee', R.A_after, 105810 - 105.81);
}

// T11: no NaN at edge-case inputs
{
  for (const o of [{ gross: 0 }, { initial: 0, monthly: 0 }, { askCeiling: 0 }, { taxDiv: 0.5 },
                   { infl: 0.15, horizon: 40 }, { horizon: 1, drawMode: 'kink' },
                   { threshUsed: 1e9 }, { reg: 0.1, horizon: 40 }]) {
    const R = simulate(P(o));
    if (!isFinite(R.A_after) || !isFinite(R.B_after)) { console.log('T11 NaN for', JSON.stringify(o)); fails++; }
  }
  console.log('T11 edge cases ok (no NaN lines above)');
}

// T12: harvesting is skipped in the sale year (it would only add fees)
{
  const R1 = simulate(P({ horizon: 1, gross: 0.07, feePct: 0.001, feeMin: 25, harvest: true }));
  check('T12 1 year with harvest = only the final sale fee', R1.B_fee, Math.max(0.001 * 107000, 25), 1);
}

// T13: månedsopsparing — buy-side kurtage per bucket
{
  const o = { initial: 0, monthly: 1000, horizon: 1, gross: 0, feePct: 0.001, feeMin: 25 };
  // no månedsopsparing anywhere: every 1,000 kr buy pays the 25 kr minimum
  const R = simulate(P(Object.assign({}, o, { msAsk: false, msDepot: false })));
  check('T13 ASK after (12x25 buy fees + 25 sale fee)', R.A_after, 12000 - 300 - 25);
  check('T13 depot after (same)', R.B_after, 12000 - 300 - 25);
  // månedsopsparing on the taxable account only (the default UI setting)
  const R2 = simulate(P(Object.assign({}, o, { msAsk: false, msDepot: true })));
  check('T13b depot buys free, ASK buys pay', R2.B_after - R2.A_after, 300, 0.01);
}

// T14: the purchase fee is deductible — via the cost basis in the taxable account,
// via the value-minus-gross-deposits base in the ASK
{
  const R = simulate(P({ initial: 10000, monthly: 0, gross: 0.07, feePct: 0, feeMin: 25, msAsk: false, msDepot: false }));
  const v = 9975 * 1.07;
  check('T14 ASK tax base net of buy fee', R.A_tax, (v - 10000) * 0.17);
  check('T14 depot gain measured against gross basis', R.B_tax, (v - 10000) * 0.27);
}

console.log(fails ? `\n${fails} FAILURES` : '\nALL TESTS PASS');
process.exit(fails ? 1 : 0);
