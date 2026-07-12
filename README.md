# Aktiesparekonto vs. frit depot

An interactive comparison of the tax efficiency of saving through a Danish
*aktiesparekonto* (a tax-favored investment account with 17% mark-to-market
taxation) versus a regular taxable brokerage account holding a Danish
realisation-taxed index fund (27/42% share income tax) — accounting for fund
costs, currency exchange fees, the deposit ceiling, distributions, and how you
eventually sell out.

**Try it here (in Danish): [jacobbundgaard.dk/aktiesparekonto](https://jacobbundgaard.dk/aktiesparekonto)**

The model simulates month by month with annual tax settlement, and the final
drawdown year by year: whatever is not yet sold stays invested, keeps
distributing, and is taxed along the way (the ASK is withdrawn in parallel over
the same years), so multi-year sale strategies are compared on equal cash-flow
timing. Realised losses in the taxable account are netted against the year's
dividends and gains and carried forward, mirroring the source-limited loss
rules for listed share-based funds (carry left unused when the model ends is
counted as worthless). In "up to the threshold" mode the strategy that needs the longest
band-limited exit sets a common sale window for both (capped at 30 years, with
a flagged forced sale of any remainder). The chart plots after-tax wealth if
everything were sold in a given year; the chosen plan's payout path is drawn
separately from the horizon onwards. Every assumption is an editable input,
and the methodology — including the deliberate simplifications — is documented
in detail at the bottom of the page itself ("Sådan regner modellen").

## Files

| File | Contents |
|---|---|
| `index.html` | The page: UI, chart, and explanations. No dependencies, no build step. |
| `sim.js` | All calculation logic — pure math with no DOM, runnable directly in Node. |
| `test/sim.test.js` | Numeric tests of the logic; every expected value is worked out by hand. |
| `test/ui.test.js` | Smoke test that runs the page script against a DOM stub and clicks around. |

## Running the tests

Requires only [Node.js](https://nodejs.org) — no packages:

```
node test/sim.test.js
node test/ui.test.js
```

## Rates and sources (2026)

- Aktiesparekonto: 17% mark-to-market (*lager*) taxation, deposit ceiling of
  DKK 174,200, headroom measured against the account value on 31 December, and
  paid tax may always be re-deposited — aktiesparekontoloven §§ 9, 13–14 and
  [skat.dk](https://skat.dk/borger/aktier-og-andre-vaerdipapirer/aktiesparekonto).
- Share income (*aktieindkomst*): 27% up to the progression threshold of
  DKK 79,400 (doubled for married couples, personskatteloven § 8 a, stk. 4),
  42% above — [skm.dk rate tables](https://skm.dk/tal-og-metode/satser).
- The already-enacted extra uplift of the progression threshold from 2027
  (DKK 83,100 in 2025-level, ≈ DKK 87,100 in 2026-level) is modelled as its
  own editable parameter.
- Both limits are adjusted annually under personskatteloven § 20; the model
  projects them forward at a shared, editable rate.
- Trading commissions are split per market: one schedule for the Danish-listed
  funds in the taxable account, another for the ASK's Xetra-listed ETF. In the
  taxable account, purchase commissions join the cost basis and sale commissions
  reduce the disposal sum, as in the actual assessment.
- Fund costs are TERs (not the Danish ÅOP measure), and distribution rates are
  averages of the 2024–25 income years — see the explanations on the page.

Spotted an error, or disagree with an assumption? Issues and pull requests are
welcome.

## Development

Built with [Claude Code](https://claude.com/claude-code): the tax rules and
fund/broker figures were researched and verified against primary sources
(skat.dk, skm.dk, retsinformation.dk, fund providers), and the model was
reviewed and tested against hand-computed expectations before publication.
The tests in `test/` are part of that verification and run in CI on every push.

## Disclaimer

This tool exists to inform your own decision. It is not tax advice, financial
advice, or a recommendation. Always check current rates with your broker and
at skat.dk.
