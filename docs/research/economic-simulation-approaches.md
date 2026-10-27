# Economic simulation approaches for a closed-loop money game

Research date: 2026-10-27. Method: primary sources fetched where reachable; anything I could not open is flagged in "Unverified / open questions". Recommendations in sections 6 are my own engineering judgement, labelled as such.

## Summary / recommendation

1. **Build a ledger-first, stock-flow-consistent (SFC) core.** Every money movement is a double-entry transaction between two accounts; balances are derived from (or reconciled against) the journal. This is the game-engineering equivalent of the Godley-Lavoie transaction-flow matrix (rows sum to zero) plus balance-sheet matrix (every financial asset is someone's liability). Minsky's "Godley Table" encodes exactly this: all transactions recorded twice, Assets - Liabilities = Equity ([Keen, SD Conf. 2024](https://proceedings.systemdynamics.org/2024/papers/P1047.pdf)).
2. **Start with Godley-Lavoie model SIM** (households, firms-as-producers, government, with government-issued money only), then PC (adds bills, central bank, portfolio choice), then add a commercial bank that creates deposits by lending (Bank of England mechanics), then firms with loans/investment, then optional agent heterogeneity (Caiani-style AB-SFC).
3. **Hybrid architecture**: aggregate/sector accounts for the first phases; keep individual household/firm accounts in the same ledger so you can move to agent-based without changing the core. The ledger does not care whether an account is a sector aggregate or a single agent.
4. **Pure deterministic tick function** `(state, params, seeded_rng, player_actions) -> (state', journal)`; invariants asserted every tick; rendering is a separate read-only consumer of the journal. TypeScript (or Rust compiled to WASM) for the core; no existing SFC library is suitable to embed (they are R/Python equation-solvers), use them as **reference oracles for tests**.
5. **Bootstrap**: government spends first by issuing central-bank money (gov deficit financed by central bank = monetization). In SIM this is the model itself: `Hs = Hs(-1) + G - T`, i.e. money stock grows by the deficit, starting from zero.

## 1. Stock-flow consistent modelling

**Principles.** Godley & Lavoie, *Monetary Economics* (Palgrave Macmillan, 2007; 2nd ed. 2012) is the canonical source; it builds each model from a transactions-flow matrix and a balance-sheet matrix and then adds behavioural equations (publisher page: [Springer chapter list](https://www.springerprofessional.de/government-money-with-portfolio-choice/7276038) for ch. 4). Minsky's docs attribute the double-entry-table approach to Godley with Francis Cripps ([Minsky docs mirror](https://minsky-marketing-1jg4g.sevalla.app/docs/minsky-modelling-godley-tables)). Note: I could not open the book itself; the equations below are verified from code replications that cite it (see section 5).

**Why it enforces closed loops.** Every flow is a row/column entry that nets to zero across sectors, and every change in a stock equals the sum of flows into it. Keen's Minsky doc: in a Godley Table "rows sum to zero, but columns add up all the flows into and out of a given account, which gives the rate of change of that account" ([Minsky docs mirror](https://minsky-marketing-1jg4g.sevalla.app/docs/minsky-modelling-godley-tables)). Money cannot appear or vanish except through an explicit creation/destruction transaction.

**Model SIM (G&L ch. 3).** Verified as code in the sfcr README (R, MIT) ([github.com/joaomacalos/sfcr](https://github.com/joaomacalos/sfcr)) and independently in pysolve3's README ([github.com/gpetrini/pysolve3](https://github.com/gpetrini/pysolve3)), which says it follows chapter 3 of Godley & Lavoie:

```
Cs = Cd ; Gs = Gd ; Ns = Nd              (supply = demand)
Y  = Cs + Gs                              (income = consumption + gov spending)
Nd = Y / W                                (employment)
Td = theta * W * Ns ; Ts = Td             (taxes)
YD = W*Ns - Ts                            (disposable income)
Cd = alpha1*YD + alpha2*Hh(-1)            (consumption)
Hh = Hh(-1) + YD - Cd                     (household money stock; = saving)
Hs = Hs(-1) + Gd - Td                     (money supply = cumulative deficit)
```
sfcr example parameters: `Gd=20, W=1, alpha1=0.6, alpha2=0.4, theta=0.2`. Equilibrium `Hh = Hs` holds as a consequence (one equation is redundant, a standard SFC check). Money here is government-issued: every unit exists because the government spent more than it taxed. This is the cleanest "money is created by deficit spending and circulates" lesson.

**Model PC (G&L ch. 4).** Adds interest-bearing government bills, a central bank, and household portfolio choice between bills and money. I could only verify the equations through a third-party implementation, MacroStat ([macrostat PC equations](https://macrostat.readthedocs.io/en/stable/_sources/models/GL06/GL06PC/equations.rst.txt)), which labels them as Godley-Lavoie 2006/2007 model PC:

```
Bcb(t) = Bs(t) - Bh(t)                         central bank holds the bills households don't
Hs(t)  = Hs(t-1) + (Bcb(t) - Bcb(t-1))         central bank money created by buying bills
Bs(t)  = Bs(t-1) + (G + r(-1)Bs(-1)) - (T + r(-1)Bcb(-1))   bill issuance = deficit, net of CB profit remitted
C      = a1*YD + a2*V(-1)
YD     = Y - T + r(-1)*Bh(-1)
T      = theta*(Y + r(-1)*Bh(-1))
V      = V(-1) + YD - C
Hh     = V - Bh                                 cash = wealth - bills
Bh/V   = l0 + l1*r - l2*YD/V                    portfolio choice
Y      = [a1(1-theta) r(-1)Bh(-1) + a2 V(-1) + G] / (1 - a1(1-theta))
```
Key point for the game: **PC is the monetization mechanism.** The government sells bills; whatever households do not take, the central bank buys, and central-bank purchase creates high-powered money (`Hs` rises by `Bcb` change). Kenn Takara's repo implements SIM, SIMEX, PC, LP, REG, OPEN, BMW, DIS, INSOUT, GROWTH etc. as notebooks based on Zezza's implementation, MIT license ([github.com/kennt/monetary-economics](https://github.com/kennt/monetary-economics)). **LP (ch. 5, liquidity preference / Tobin-style with equities/bonds and capital gains)**: I verified only that it exists in that repo; I did not verify equations.

**Transaction-flow matrix + balance-sheet matrix.** Matrix form per G&L (not directly verified from the book); the Minsky formulation of the same idea is quoted above. Practical meaning: each column is a sector, each row a transaction type; rows sum to zero; the balance sheet matrix has each financial instrument row summing to zero (non-financial rows - tangible capital - sum to net worth).

## 2. Double-entry / balance-sheet approach and mapping to a ledger

- Bank of England: money is created by loans: "Whenever a bank makes a loan, it simultaneously creates a matching deposit in the borrower's bank account, thereby creating new money." Repayment reverses it: "Just as taking out a new loan creates money, the repayment of bank loans destroys money." ([BoE QB 2014 Q1, PDF](https://www.bankofengland.co.uk/-/media/boe/files/quarterly-bulletin/2014/money-creation-in-the-modern-economy.pdf); article page [here](https://www.bankofengland.co.uk/quarterly-bulletin/2014/q1/money-creation-in-the-modern-economy)). I extracted these quotes from the PDF text. The article's Figure 1 uses balance-sheet bars: loan appears as an asset of the bank and deposit as a liability, and the same deposit is an asset of the borrower.
- Mapping to data structure (my design): each account has `{owner, kind: asset|liability, instrument: cash|deposit|loan|bill|reserve|equity}`. A **loan issuance** posts two entries atomically: Bank asset `Loan(borrower)` +X, Bank liability `Deposit(borrower)` +X (borrower side mirrors: asset deposit, liability loan). **Repayment** is the reverse and removes X from deposits. Both are "creation/destruction" transactions that are the only ones where total deposits change.
- **Government spending / central bank**: BoE notes central bank asset purchases (QE) create deposits and reserves ("central bank asset purchases, known as quantitative easing (QE), have similar implications for money creation") ([BoE PDF](https://www.bankofengland.co.uk/-/media/boe/files/quarterly-bulletin/2014/money-creation-in-the-modern-economy.pdf)). In the game: gov issues bill -> central bank buys bill -> CB credits gov account (reserves/deposit) -> gov spends to households/firms -> deposits at commercial banks plus matching reserves. That is a four-line double-entry sequence.
- BoE also defines the three kinds of money - currency, bank deposits, central bank reserves - and says most money is bank deposits created by banks ([Money in the modern economy: an introduction](https://www.bankofengland.co.uk/quarterly-bulletin/2014/q1/money-in-the-modern-economy-an-introduction)).
- Minsky Godley Table is a working precedent of "ledger as the modelling primitive": the table generates the model's differential equations ([Keen, Substack](https://profstevekeen.substack.com/p/using-system-dynamics-with-minsky)).

## 3. Agent-based vs aggregate vs hybrid

- **Aggregate (difference equations)**, e.g. SIM/PC: a handful of equations solved per period (sfcr uses Gauss-Seidel or Broyden solvers, per [CRAN sfcr manual](https://cran.r-project.org/web/packages/sfcr/refman/sfcr.html)); pysolve3 offers Gauss-Seidel, Newton-Raphson, Broyden ([pysolve3](https://github.com/gpetrini/pysolve3)). Pros: deterministic, tiny, explainable ("this equation says consumption is 60% of income"). Cons: no heterogeneity, no distribution, no bankruptcies; simultaneous equations need a solver (or you rewrite with lags so each tick is sequential - recommended in a game).
- **Agent-based SFC (AB-SFC)**: Caiani, Godin, Caverzasi, Gallegati, Kinsella, Stiglitz, "Agent based-stock flow consistent macroeconomics: Towards a benchmark model", JEDC 69 (2016) 375-408, combine ABM with SFC accounting and argue this captures endogenous money and complexity; open-access manuscript at [Kingston repository](https://eprints.kingston.ac.uk/35296/1/Godin-A-35296-AAM.pdf) (could not fetch; abstract details via [IDEAS/RePEc](https://ideas.repec.org/a/eee/dyncon/v69y2016icp375-408.html)). 
- **Eurace@Unibi** (Dawid et al.) is a large ABM, described as a closed macro model, run on the Flame platform; source for v1.0 listed as available ([Bielefeld ETACE](https://uni-bielefeld.de/fakultaeten/wirtschaftswissenschaften/lehrbereiche/etace/eurace@unibi/the-eurace@unibi-model)). **JAMEL** (Seppecher): Java ABM of a monetary economy with firms and households ([HAL paper](https://halshs.archives-ouvertes.fr/halshs-00697225)).
- **Tradeoffs for a game** (my judgement): ABM gives emergent stories (a firm fails, jobs vanish) and visual per-agent flows, but needs Monte Carlo averaging for research validity, is harder to balance, and harder to explain. Seeded PRNG keeps ABM deterministic enough for replay/tests. Recommended: **aggregate sectors first, designate "agent classes" later** (e.g. 100 household agents inside the household sector), all through the same ledger.
- **System dynamics tools** (PySD translates Vensim/XMILE models into Python, [docs](https://pysd.readthedocs.io/en/master/)) are for stock-and-flow ODE models; they do not enforce double-entry by themselves. Minsky adds Godley Tables on top of SD for that reason.

## 4. Endogenous money / MMT references

- BoE (above): lending creates deposits; money multiplier is "not an accurate description of how money is created in reality"; central banks set the interest rate rather than reserve quantity ([BoE PDF](https://www.bankofengland.co.uk/-/media/boe/files/quarterly-bulletin/2014/money-creation-in-the-modern-economy.pdf)). Exact quote from the PDF text I extracted: "While the money multiplier theory can be a useful way of introducing money and banking in economic textbooks, it is not an accurate description of how money is created in reality."
- BoE: reserves "cannot be multiplied into more loans and deposits" ([same PDF](https://www.bankofengland.co.uk/-/media/boe/files/quarterly-bulletin/2014/money-creation-in-the-modern-economy.pdf)); households/companies can destroy money by repaying debt.
- Keen's Minsky post "Using system dynamics with Minsky to prove the core tenets of MMT" is Keen's own argument and illustrates government deficit = non-government surplus in Godley-table form ([Substack](https://profstevekeen.substack.com/p/using-system-dynamics-with-minsky)). Treat as one author's interpretation, not neutral authority. I did not retrieve primary MMT texts (Wray, Mosler, Mitchell); Fed/ECB balance-sheet docs also not retrieved (see open questions).
- Design caveat: SIM models a government that issues money directly; real systems have bills + central bank + commercial banks (PC and later). Present SIM as a deliberate simplification ("consolidated government + central bank").

## 5. Existing implementations

| Project | Language | License | Maturity / use for us |
|---|---|---|---|
| sfcr ([GitHub](https://github.com/joaomacalos/sfcr)) | R | MIT | On CRAN (v0.2.3, Oct 2025 per [CRAN manual](https://cran.r-project.org/web/packages/sfcr/refman/sfcr.html)); 116 commits, vignettes replicating G&L models. Reference/oracle for tests, not embeddable. |
| pysolve3 ([GitHub](https://github.com/gpetrini/pysolve3)) | Python (sympy) | MIT | Port of Kenn Takara's pysolve; 141 commits. Reference/oracle. |
| kennt/monetary-economics ([GitHub](https://github.com/kennt/monetary-economics)) | Python notebooks | MIT | SIM through OPENFLEX chapters, based on Zezza's code. Best source of ready-made expected series for tests. |
| Minsky ([GitHub](https://github.com/highperformancecoder/minsky)) | C++/TypeScript/Python scripting | GPL-3.0 | Desktop SD tool with Godley Tables. Usable for prototyping/visualising a model; GPL prevents embedding in a closed game. |
| PySD ([docs](https://pysd.readthedocs.io/en/master/)) | Python | not verified (page links a LICENSE file) | Runs Vensim/XMILE; no double-entry. Not a fit for the core. |
| Eurace@Unibi ([Bielefeld](https://uni-bielefeld.de/fakultaeten/wirtschaftswissenschaften/lehrbereiche/etace/eurace@unibi/the-eurace@unibi-model)) | C on Flame | not verified | Research ABM; reference for design, too heavy to embed. |
| JAMEL ([HAL](https://halshs.archives-ouvertes.fr/halshs-00697225), mirror [eolach/jamel](https://www.github.com/eolach/jamel)) | Java | not verified | Research ABM; reference only. |
| InsightMaker "Model SIM GD" ([insightmaker.com](https://insightmaker.com/insight/5mPq9V9dDMza3A1dAh7mgU/Model-SIM-GD)) | web SD | n/a | Quick visual SIM, not verified in detail. |

Conclusion: none are intended to run inside a game. Use them to generate **golden test fixtures** (run SIM/PC in sfcr or pysolve3, record series, assert your TS/Rust port matches).

## 6. Architecture recommendation (author's design)

**Principles**
1. The ledger is the only way money moves. No code mutates a balance directly; `post(tx)` is the sole mutator.
2. Transactions are balanced: sum of debits == sum of credits, enforced by `post`.
3. Money creation and destruction are explicit tx types (`LOAN_ISSUE`, `LOAN_REPAY`, `CB_BUY_BILL`, `GOV_SPEND`), never implicit.
4. Sim core is pure and deterministic: no wall clock, no global RNG, no rendering imports. Same seed and same player actions give same journal.
5. Renderer subscribes to the journal (each entry = one animated flow of coins from account A to B).

**Minimal data model (TypeScript-ish)**
```ts
type Sector = 'HOUSEHOLD'|'FIRM'|'BANK'|'GOV'|'CENTRAL_BANK';
type Instrument = 'CASH'|'DEPOSIT'|'RESERVE'|'LOAN'|'BILL'|'EQUITY';
interface Account { id; sector: Sector; owner: string }
// Position: holder's ASSET in an instrument issued by `issuer` (issuer's liability).
interface Position { holder: AccountId; issuer: AccountId; instrument: Instrument; amount: bigint }
interface Entry { kind: 'FLOW'|'CREATE'|'DESTROY'; from: AccountId; to: AccountId; instrument: Instrument;
                  issuer: AccountId; amount: bigint; reason: string; tick: number }
interface World { tick: number; positions: Map<string, Position>; journal: Entry[]; rng: RngState; params: Params }
```
Each financial position is stored once but read from both sides: holder's asset, issuer's liability. That makes "every asset has a matching liability" structural, not a check. Use integer minor units (bigint/int64), never floats, so conservation is exact. Equity (net worth) is derived = assets - liabilities, which is the Minsky identity ([Keen 2024](https://proceedings.systemdynamics.org/2024/papers/P1047.pdf)).

**Tick sketch (SIM-like phase)**
```
tick(world, actions):
  apply player actions (policy: G, theta, ...)           // become params for this tick
  # government spends first (bootstrap): CB creates reserves/cash for gov, then gov pays
  1. gov_spend:   CB->GOV create CASH(G if not enough);  GOV->FIRM  pay G           // deficit => new money
  2. production:  Y = demand_last + G (lagged, so no solver needed)
  3. wages:       FIRM->HH   pay W*N
  4. taxes:       HH->GOV    pay theta*W*N
  5. consumption: HH->FIRM   pay alpha1*YD + alpha2*H(-1)
  6. later phases: banks: LOAN_ISSUE / LOAN_REPAY / interest; CB_BUY_BILL
  invariants(world)   // throws in dev, logs + halts in prod
  world.tick++
```
Using lags instead of simultaneous equations avoids needing Gauss-Seidel in the game; verify convergence of the lagged version to SIM's equilibrium against sfcr/pysolve3 output (tests). SIM's closed form uses `Y = (G)/(1 - alpha1(1-theta))` style steady states; compare numerically rather than trust my algebra.

**Invariants (every tick)**
- Per instrument: sum of holders' assets == sum of issuers' liabilities (by construction; verify).
- Sum over all sectors of net worth == value of non-financial assets (0 in pure-money phases).
- `GOV` cumulative deficit == change in (gov-issued money + bills held outside the central bank) in SIM/PC terms (`Hs - Hs(-1) = G - T`).
- Total deposits change per tick == Σ(LOAN_ISSUE) - Σ(LOAN_REPAY) + Σ(CB/gov money-creation entries).
- No negative balances unless the instrument permits overdraft by policy.
- Property-based tests: random action sequences -> invariants hold; replay journal -> identical state; golden series vs sfcr/pysolve3.

**Stack suggestions (judgement)**: core in TypeScript (browser-ready, easy visualisation with D3/PixiJS) or Rust (-> WASM, native engines). Godot/Unity as thin rendering shells over a JSON/FFI boundary. Python is fine for the prototype/oracle harness (pysolve3/sfcr fixtures).

**Visualisation**: one animated token per journal entry; colour by instrument; creation events (loan, CB purchase) shown as "mint" glyphs, destruction as "burn". Side panel: live balance-sheet T-accounts per sector and a rolling transaction-flow matrix (rows sum to zero) - the Godley-table view, which Minsky also uses. A "why" tooltip links each flow to the equation line.

**Phased build path**
1. **SIM-lite**: HH, FIRM, GOV; money only from gov deficit. Tests vs sfcr SIM.
2. Add **central bank + bills** (PC), monetization toggle (CB buys unsold bills); interest.
3. Add **commercial bank**: loan issue/repay, deposits, reserves, interest margin; firm investment funded by loans (BoE mechanics).
4. Add **defaults and bank capital**, bankruptcy as explicit write-off transactions (a loan write-off destroys deposits? No: it reduces bank equity and the loan asset; deposits remain - encode and test this explicitly).
5. **Heterogeneous agents** (Caiani-style), seeded stochasticity, scenario/policy challenges.

## Sources

- Bank of England, Money creation in the modern economy, QB 2014 Q1: https://www.bankofengland.co.uk/quarterly-bulletin/2014/q1/money-creation-in-the-modern-economy ; PDF https://www.bankofengland.co.uk/-/media/boe/files/quarterly-bulletin/2014/money-creation-in-the-modern-economy.pdf
- Bank of England, Money in the modern economy: an introduction: https://www.bankofengland.co.uk/quarterly-bulletin/2014/q1/money-in-the-modern-economy-an-introduction
- sfcr (GitHub): https://github.com/joaomacalos/sfcr ; CRAN manual https://cran.r-project.org/web/packages/sfcr/refman/sfcr.html
- pysolve3: https://github.com/gpetrini/pysolve3
- kennt/monetary-economics: https://github.com/kennt/monetary-economics
- MacroStat GL06 PC equations (secondary implementation): https://macrostat.readthedocs.io/en/stable/_sources/models/GL06/GL06PC/equations.rst.txt
- Godley & Lavoie ch. 4 listing: https://www.springerprofessional.de/government-money-with-portfolio-choice/7276038
- Minsky repo: https://github.com/highperformancecoder/minsky ; docs mirror https://minsky-marketing-1jg4g.sevalla.app/docs/minsky-modelling-godley-tables
- Keen, SD Conference 2024: https://proceedings.systemdynamics.org/2024/papers/P1047.pdf ; Keen Substack https://profstevekeen.substack.com/p/using-system-dynamics-with-minsky
- Caiani et al. 2016: https://ideas.repec.org/a/eee/dyncon/v69y2016icp375-408.html ; manuscript https://eprints.kingston.ac.uk/35296/1/Godin-A-35296-AAM.pdf
- Eurace@Unibi: https://uni-bielefeld.de/fakultaeten/wirtschaftswissenschaften/lehrbereiche/etace/eurace@unibi/the-eurace@unibi-model
- JAMEL: https://halshs.archives-ouvertes.fr/halshs-00697225 ; https://www.github.com/eolach/jamel
- PySD: https://pysd.readthedocs.io/en/master/

## Unverified / open questions

- **Godley & Lavoie book not opened.** SIM equations verified only via sfcr/pysolve3 READMEs (code replicating the book). PC equations come from MacroStat, a third-party port; check against the book (ch. 4) and Takara/Zezza code. LP (ch. 5) equations not retrieved. The matrix layouts described are from general knowledge plus Minsky docs, not from the book text.
- Levy Institute / Zezza papers: fetched one candidate PDF (levyinstitute.org/pubs/wp_602.pdf) but it was unreadable binary; not cited.
- Caiani et al. full text was unreachable (DNS failure); model details (sector list, timing, validation) are not verified here. Also Eurace@Unibi stock-flow-consistency and license not confirmed; JAMEL license and canonical repo not confirmed; PySD license not confirmed.
- Minsky docs were read via a mirror domain (sevalla.app), not the official minsky site; Minsky release info and Godley-table support in the repo README were not seen directly.
- Fed/ECB balance-sheet documentation and primary MMT texts (Wray, Mitchell, Kelton) were not retrieved; treatment of government spending mechanics relies on BoE plus PC/SIM equations.
- BoE passages quoted were extracted from the PDF locally; the HTML pages only returned summaries.
- Open design question: treat the central bank as separate from the Treasury in phase 1 (SIM consolidates them)? Whether a loan write-off should destroy deposits (it does not, in standard accounting: it reduces bank equity) should be confirmed with a primary accounting source before teaching it.
