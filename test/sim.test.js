// Numeriske tests af beregningslogikken i sim.js — kør med:  node test/sim.test.js
// Ingen afhængigheder. Hver test er regnet efter i hånden ud fra 2026-reglerne.
const { aktieTax, bracketTax, drawdown, simulate } = require('../sim.js');

const BASE = {
  initial: 100000, monthly: 0, horizon: 1, gross: 0.07, infl: 0,
  askTer: 0, askForex: 0, askTax: 0.17, askCeiling: 1e12, reg: 0,
  taxTer: 0, taxDiv: 0, divMode: 'cash', taxLow: 0.27, taxHigh: 0.42, threshold: 79400,
  threshUsed: 0, married: false, liqYears: 1, redeposit: true, drawMode: 'years',
  harvest: false, feePct: 0, feeMin: 0
};
const P = o => Object.assign({}, BASE, o);
const r2 = x => Math.round(x * 100) / 100;
let fails = 0;
function check(name, got, want, tol = 0.01) {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: got ${r2(got)}, want ${r2(want)}`);
}

// T1: 1 år, engangsindskud, ingen omkostninger. 7 % p.a. via månedlig rente.
{
  const R = simulate(P({}));
  check('T1 ASK efter skat', R.A_after, 107000 - 7000 * 0.17);
  check('T1 depot efter skat', R.B_after, 107000 - 7000 * 0.27);
}

// T2: vekselomkostningen er fradragsberettiget i lagerbeskatningen
// (indskud tæller brutto: grundlag = værdi - 100.000, ikke - 99.750)
{
  const R = simulate(P({ askForex: 0.0025 }));
  const v = 99750 * 1.07;
  check('T2 ASK-skat (grundlag mod bruttoindskud)', R.A_tax, Math.max(0, v - 100000) * 0.17);
}

// T3: indskudsplads måles mod værdien pr. 31/12 FØR skattetræk (skatten hæves
// først i februar), plus skatten selv, som altid må genindskydes (§ 9, stk. 2).
{
  // loft 100k, indskud 90k, 20 % afkast: ultimo v=108.000, skat 3.060.
  // År 2-plads = max(0, 100.000-108.000) + 3.060 = 3.060.
  const R = simulate(P({ askCeiling: 100000, initial: 90000, monthly: 300, horizon: 2, gross: 0.20 }));
  check('T3 overløb starter år 2 (3.600 tilbudt > 3.060 plads)', R.firstOverflow, 2, 0);
  const R2 = simulate(P({ askCeiling: 100000, initial: 90000, monthly: 255, horizon: 2, gross: 0.20 }));
  check('T3b intet overløb (3.060 tilbudt = plads)', R2.firstOverflow === null ? 1 : 0, 1, 0);
}

// T4: udtrækning — begge strategier, flad grænse (reg = 0)
{
  const d1 = drawdown(1000000, 400000, P({ liqYears: 1 }), 79400, 0);
  check('T4 engangssalg', d1.tax, 79400 * 0.27 + 520600 * 0.42);
  const d2 = drawdown(1000000, 400000, P({ drawMode: 'kink' }), 79400, 0);
  check('T4 op-til-grænsen skat', d2.tax, 600000 * 0.27);
  check('T4 op-til-grænsen år', d2.years, 8, 0);
  const d3 = drawdown(1000000, 400000, P({ liqYears: 10 }), 79400, 0);
  check('T4 fordelt over 10 år', d3.tax, 10 * 60000 * 0.27);
}

// T4b-e: grænsen i salgsårene — regulering, brugt bånd, degenererede tilfælde
{
  const d2 = drawdown(1000000, 920600, P({ liqYears: 1 }), 79400, 79400);
  check('T4c bånd fuldt brugt -> alt til høj sats', d2.tax, 79400 * 0.42);
  const d3 = drawdown(1000000, 400000, P({ drawMode: 'kink', threshUsed: 39400 }), 79400, 39400);
  check('T4d 40k frit bånd pr. år -> 15 år', d3.years, 15, 0);
  const d4 = drawdown(1000000, 400000, P({ drawMode: 'kink', threshUsed: 100000 }), 79400, 100000);
  check('T4e bånd åbner aldrig -> alt 42 %', d4.tax, 600000 * 0.42);
}

// T5: udbyttebogholderi. 1 år, 2 % udbytte, 0 % afkast.
{
  // kontant: div=2.000, skat=540 -> v=99.460, basis=100.000+1.460 (netto geninvesteret)
  const R = simulate(P({ gross: 0, taxDiv: 0.02 }));
  check('T5 kontant udbytte', R.B_after, 99460);
  // teknisk: v falder kun med skatten (finansieret ved salg), basis op med brutto
  // minus forholdsmæssig anskaffelsessum for det solgte
  const R2 = simulate(P({ gross: 0, taxDiv: 0.02, divMode: 'tech' }));
  check('T5b teknisk udbytte', R2.B_after, 99460);
}

// T6: i «Op til grænsen» (alt ender på 27 %) skal større udlodning være en
// ren ulempe — samme skat, bare tidligere. (I engangssalg kan den omvendt
// hjælpe, fordi tvungen 27 %-realisation træder basis op mod 42 %-slutskat.)
{
  const D = { initial: 100000, monthly: 4000, horizon: 20, gross: 0.07, infl: 0.02,
    askTer: 0.0007, askForex: 0.0025, askCeiling: 174200, reg: 0.02,
    taxTer: 0.003, feePct: 0.001, feeMin: 25, drawMode: 'kink' };
  const b = d => simulate(P(Object.assign({}, D, { taxDiv: d }))).B_after;
  check('T6 monotont faldende i udbytte', (b(0.01) > b(0.02) && b(0.02) > b(0.03)) ? 1 : 0, 1, 0);
}

// T7: gift fordobler både loft og progressionsgrænse
{
  const R1 = simulate(P({ askCeiling: 100000, initial: 250000, horizon: 1, married: false }));
  const R2 = simulate(P({ askCeiling: 100000, initial: 250000, horizon: 1, married: true }));
  check('T7 dobbelt loft', R2.askFinal, 2 * R1.askFinal, 1);
}

// T8: «brugt af andet» skubber udbytteskatten op i høj sats
{
  check('T8 lavt bånd', simulate(P({ gross: 0, taxDiv: 0.02 })).B_tax, 2000 * 0.27);
  check('T8 højt bånd', simulate(P({ gross: 0, taxDiv: 0.02, threshUsed: 200000 })).B_tax, 2000 * 0.42);
}

// T9: refinansierings-toggle — slået fra sælges der ikke fra depotet
{
  const o = { askCeiling: 100000, initial: 200000, horizon: 5, gross: 0.07, feePct: 0.001, feeMin: 25 };
  const on  = simulate(P(Object.assign({}, o, { redeposit: true })));
  const off = simulate(P(Object.assign({}, o, { redeposit: false })));
  check('T9 ingen handelsomkostninger uden refinansiering', off.A_fee < on.A_fee ? 1 : 0, 1, 0);
}

// T10: ASK-slutsalget betaler kurtage (og derefter veksling)
{
  const R = simulate(P({ feePct: 0.001, feeMin: 25 }));
  check('T10 A efter kurtage', R.A_after, 105810 - 105.81);
}

// T11: ingen NaN ved kantværdier
{
  for (const o of [{ gross: 0 }, { initial: 0, monthly: 0 }, { askCeiling: 0 }, { taxDiv: 0.5 },
                   { infl: 0.15, horizon: 40 }, { horizon: 1, drawMode: 'kink' },
                   { threshUsed: 1e9 }, { reg: 0.1, horizon: 40 }]) {
    const R = simulate(P(o));
    if (!isFinite(R.A_after) || !isFinite(R.B_after)) { console.log('T11 NaN for', JSON.stringify(o)); fails++; }
  }
  console.log('T11 kantværdier ok (ingen NaN-linjer ovenfor)');
}

// T12: skattehøst springes over i salgsåret (ren kurtage uden effekt)
{
  const R1 = simulate(P({ horizon: 1, gross: 0.07, feePct: 0.001, feeMin: 25, harvest: true }));
  check('T12 1 år med høst = kun slutsalgets kurtage', R1.B_fee, Math.max(0.001 * 107000, 25), 1);
}

console.log(fails ? `\n${fails} FEJL` : '\nALLE TESTS BESTÅET');
process.exit(fails ? 1 : 0);
