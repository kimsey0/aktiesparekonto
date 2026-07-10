# Aktiesparekonto vs. frit depot

An interactive comparison of the tax efficiency of saving through a Danish
*aktiesparekonto* (a tax-favored investment account with 17% mark-to-market
taxation) versus a regular taxable brokerage account holding a Danish
realisation-taxed index fund (27/42% share income tax) — accounting for fund
costs, currency exchange fees, the deposit ceiling, distributions, and how you
eventually sell out.

**Try it here (in Danish): [jacobbundgaard.dk/aktiesparekonto](https://jacobbundgaard.dk/aktiesparekonto)**

The model simulates month by month with annual tax settlement. Every assumption
is an editable input, and the methodology — including the deliberate
simplifications — is documented in detail at the bottom of the page itself
("Sådan regner modellen").

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
- Both limits are adjusted annually under personskatteloven § 20; the model
  projects them forward at a shared, editable rate.
- Fund costs are TERs (not the Danish ÅOP measure), and distribution rates are
  averages of the 2024–25 income years — see the explanations on the page.

Spotted an error, or disagree with an assumption? Issues and pull requests are
welcome.

## Development

Built with [Claude Code](https://claude.com/claude-code): the tax rules and
fund/broker figures were researched and verified against primary sources
(skat.dk, skm.dk, retsinformation.dk, fund providers), and the model was
reviewed and tested against hand-computed expectations before publication.
The tests in `test/` are part of that verification and run on every change.

## Disclaimer

This tool exists to inform your own decision. It is not tax advice, financial
advice, or a recommendation. Always check current rates with your broker and
at skat.dk.
