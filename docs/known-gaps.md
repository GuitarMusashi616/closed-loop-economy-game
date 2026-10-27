# Known gaps

Where the implementation of the original spec (issue #1, tickets #2–#16) falls short, or is weaker than the spec describes. Found by the code review and the implementers' reports. Nothing here has been tuned or fixed unless stated.

## Spec coverage

- **Story 22, spreads.** `setSpreads` supports the retail and collateralised spreads, but the UI exposes only the retail one. There is no separate Tuition Loan spread: the tuition rate is derived, halfway between the secured and Retail Credit rates.
- **Story 46, taste shocks.** Tastes drift and mean-revert every Tick, but there are no occasional discrete shocks.
- **Story 66, children.** Working households don't explicitly support children. Only pensions exist.
- **Supply and demand curves (story 50).** The Products screen shows supply and demand as bars, not curves, because the sim holds no price-curve data.
- **Technology unlocks (story 83).** Technologies unlock new food Products (Fruit, Fish), extra research slots and yield bonuses. The `unlocks.industries` ids in `technologies.json` (advanced-energy, consumer-goods, electronics) are data only: no such Industries exist and there is no mechanism to unlock one.
- **Stories 54, 72–74 and 77** were checked quickly and look covered. The rest of the numbered stories were not traced individually.

## Economy balance

- **Thin supply web.** Only Households buy final goods, so intermediate demand is small. Outside Agriculture, Industries shrink to about 1–2 workers over a long run, and Construction stays near zero because demand for `buildings` is about 1 unit a Tick. The #7 criterion "a slump in Manufacturing visibly slows other Industries" passes in tests (across seeds 1, 7 and 42) but the underlying economy is small. Nobody checked that the slump test fails when the effect is removed.
- **Starvation.** Agriculture's starting output covers a fraction of the grain need, so cohorts are underfed and some deaths and emigration follow. Retirees depend on pensions, and the pension rate was not tuned.
- **Placeholder numbers.** Wage and education constants, the 30% retained share of profit, the research contract price (30 per unit, 12 units a Tick), the education demand rate (0.5% of working-age citizens) and its price cap of 20, alert thresholds (famine at hunger 60, mass layoffs at a 20% drop) and the unlock days (10 and 40) are the implementers' own picks, with no spec value behind them. A stake's dividend share, stake / (stake + 20,000), uses a placeholder for each Industry's private equity.
- **Durables.** Depreciation only lowers book value: house and car counts never shrink. Seized collateral sits on the bank as an asset and is not resold.
- **Unpaid Tuition Loans.** A student who can't pay falls behind but is not written off.

## Verification

- **sfcr oracles.** The SIM and PC reference models match the published sfcr results. The game's ledger reproduces PC's bills, money supply and Central Bank holdings over 40 periods with interest and tax switched off, so that checks deficit-financing and Monetization accounting, not dynamics. A dynamic comparison of the game against SIM is not feasible: game households buy by need and willingness to pay, not by `α1·YD + α2·H(-1)`.
- **Research notes.** The MacroStat page cited in `docs/research/economic-simulation-approaches.md` has a sign error in the PC model's Bs equation (the sfcr vignette has `+ r·Bs(-1)`). The notes have not been corrected, and the Godley and Lavoie book was not opened.
- **Cohort equivalence.** The individual-level reference agrees with the cohort model within 1–3% when households are fed or in famine. It does not agree for a half-housed cohort: the individual reference gets 1,263 deaths where the cohort model gets 0, and a test asserts that gap. The reference restates the cohort model's rule constants, so it checks that aggregation is faithful, not that the rules are right, and it covers only the Household rules.
- **No browser tests.** The UI, including the six tabs, the Sankey view and the Industry picker, is verified only by typecheck and build. Responsiveness was reasoned from per-Tick cost (about 0.3–0.5 ms at roughly 85k–110k citizens), not measured in a browser.
- **Timing tests.** They use best-of-N and wide budgets (100 ms per Tick) because they were flaky under parallel load.

## Smaller items

- **Charts.** They show only the last 600 Ticks, and the snapshot carries the last 100 notes. `tutorial()` still rebuilds a set over all flows each time (about 5–10 ms at 10,000 Ticks).
- **Explanations.** Only Industry failures and price rises of 10% or more are explained. Price falls, deaths and emigration have no explanation.
- **Sankey.** It works at sector level. Flows inside one sector are dropped.
- **Equity Stakes.** The Treasury's dividend share on a stake uses the placeholder above.
- **Saves.** Saves from before each ticket's changes are rejected on load ("predates …").
- **Vocabulary.** The `bank:*` account ids, the `"bank"` debt-holder value and `bank.ts` use a bare "bank", where `GLOSSARY.md` says "Commercial Bank". They are persisted in saves and part of the command interface, so they were left alone.
- **Industry Loan UI.** Every Industry is selectable now, but the UI has no tests.
