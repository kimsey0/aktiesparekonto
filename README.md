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
distributing, and is taxed along the way — though cash distributions are paid
out during the drawdown (counting toward the year's withdrawal) rather than
reinvested. In "fixed number of years" mode both
strategies (the ASK included) amortise evenly over the same years. In "up to
the threshold" mode the taxable-only strategy's band-limited sales define the
payout path (capped at 30 years, with a flagged forced sale of any remainder),
and the ASK strategy delivers exactly the same net cash in the same years —
funded from its own taxable account first, within the band, topped up from the
ASK — so the two strategies are compared at identical cash flows and differ
only in what remains invested at the end. When the ASK strategy is the poorer
one, it can run dry before the window ends; the tool then warns and reports
the interim cash it failed to deliver instead of matching silently. Realised
losses in the taxable account are netted against the year's dividends and
gains — including share income earned outside the model, per the annual
household assessment — and carried forward, mirroring the source-limited loss
rules for listed share-based funds (carry left unused when the model ends is
counted as worthless). The chart plots after-tax wealth if
everything were sold in a given year; the chosen plan's payout path is drawn
separately from the horizon onwards. Every assumption is an editable input,
and the methodology — including the deliberate simplifications — is documented
in detail at the bottom of the page itself ("Sådan regner modellen").

The numbers are built to be checked: the breakdown table reconciles line by
line (contributed + pre-tax return − tax − fees − FX = payout), a collapsible
year-by-year audit table shows every balance, contribution, tax and fee per
strategy — for the accumulation years and the drawdown separately — and can be
downloaded as CSV with øre precision for re-computation in a spreadsheet.
Settings that differ from the defaults are encoded in the page URL, so a
specific scenario can be shared or attached to a bug report as a link.
A compact view (the ⛶ button in the header) hides the controls and prose and
lines up the result, a chip strip naming every assumption in the current
scenario, the chart and the reconciliation table — so a single screenshot
carries both the numbers and their premises.

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
