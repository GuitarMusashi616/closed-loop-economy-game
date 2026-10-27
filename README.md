# Closed-Loop Economy Game

A web-based, non-spatial game where you are the **Government** of a fully tracked, closed-loop economy. Money is created and destroyed only through logged events (loans, Monetization, Grants, repayment, write-offs), so you can watch how money is created as debt and circulates. Your goal is to keep citizens fed, housed, educated and employed.

The simulation is deterministic: the same seed, save and commands give the same result. There is no win state.

## Requirements

- [Node.js](https://nodejs.org/) 22 or newer (developed on 22.23)
- npm (ships with Node)

## Play online

The game is deployed with GitHub Pages: https://guitarmusashi616.github.io/closed-loop-economy-game/

## Run the game locally

```sh
npm install
npm run dev
```

Vite prints a local URL (usually http://localhost:5173). Open it in a browser.

The game starts **paused** with almost no money. A quest on the main screen walks you through bootstrapping the economy.

## Playing

1. **Bootstrap.** Click the big coin to **Monetize** (the chips under it pick the deal size), **Fund** an Industry with an Industry Loan, and give a **Grant** to a Household Cohort so citizens can buy food. Orders are queued and land on the next Day.
2. **Unpause** and pick a speed with the controls in the top bar (⏸ ▶ ▶▶ ▶▶▶, or ⏭ to step one Day). One Tick is one in-game day.
3. **Watch.** The main screen holds the whole core loop: money supply, Industry cards, Household cards, the nation's vitals, alerts and your next quest. The menu buttons on the right open:

   | Menu | Shows |
   | --- | --- |
   | Research | Technology tree by branch, with progress and the controls for choosing the active Technologies |
   | Unlockables | Which levers are open and when the rest open |
   | Government | Every lever: spending, taxes, debt, pensions, public services, Policy Rate |
   | Statistics | Money flow Sankey and charts, Industries and Product markets, Citizens, balance sheets |
   | Guide | Quest log and short explanations of how the economy works |

4. **Levers unlock gradually:** spending, loans and Monetization first, taxes, debt, pensions and Markup / Discount on Day 10, the Policy Rate on Day 40.

Terms such as Cohort, Tick, Industry Loan and Equity Stake are defined in [`GLOSSARY.md`](GLOSSARY.md).

## Other commands

| Command | What it does |
| --- | --- |
| `npm test` | Run the test suite (Vitest) |
| `npm run typecheck` | Type-check with `tsc --noEmit` |
| `npm run build` | Type-check, then build to `dist/` |
| `npx vite preview` | Serve the built `dist/` locally |

## How it is built

- **Simulation core** (`src/sim`): a pure, DOM-free TypeScript library. It exposes `createWorld`, `step`, read-only views and `serialize` / `deserialize`. Tests drive it only through this interface.
- **UI** (`src/ui`): React. The simulation runs in a Web Worker (`src/ui/sim.worker.ts`), so heavy Ticks don't block the page.
- **Data files** (`src/sim/data`): Industry recipes, Products and Technologies are plain JSON.

Design decisions are recorded in [`docs/adr/`](docs/adr/):

1. [Ledger-first, stock-flow-consistent core](docs/adr/0001-ledger-first-stock-flow-consistent-core.md)
2. [State-defined cohorts with sampled Citizens](docs/adr/0002-state-defined-cohorts-with-sampled-citizens.md)
3. [Willingness-to-pay call-auction price discovery](docs/adr/0003-willingness-to-pay-call-auction-price-discovery.md)

Background reading is in [`docs/research/`](docs/research/).

## Known limitations

See [`docs/known-gaps.md`](docs/known-gaps.md) for the full list. In short:

- Outside Agriculture, Industries stay small, because only Households buy final goods. Balance numbers are placeholders and live in data files and constants.
- Saves from older versions are rejected with a "predates …" error on load.
- The UI helpers are unit-tested, but the screens themselves have no automated browser tests.
