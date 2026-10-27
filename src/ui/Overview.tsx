import { useEffect, useRef, useState } from "react";
import type { Command } from "../sim";
import { Citizens } from "./Citizens";
import { Flows } from "./Flows";
import { Industries } from "./Industries";
import { Products } from "./Products";
import { Research } from "./Research";
import type { Citizen } from "../sim";
import type { FromWorker, Snapshot, Speed, ToWorker } from "./protocol";

const SPEEDS: { label: string; speed: Speed }[] = [
  { label: "Pause", speed: 0 },
  { label: "1x", speed: 1 },
  { label: "2x", speed: 2 },
  { label: "4x", speed: 4 },
];

type Screen = "overview" | "flow" | "industries" | "citizens" | "treasury" | "research";
const SCREENS: { id: Screen; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "flow", label: "Money flow" },
  { id: "industries", label: "Industries" },
  { id: "citizens", label: "Citizens" },
  { id: "treasury", label: "Treasury and Central Bank" },
  { id: "research", label: "Research" },
];

function Locked({ open, stage }: { open: boolean; stage: string }) {
  return open ? null : <p><em>Locked: {stage}</em></p>;
}

function describe(c: Command): string {
  switch (c.type) {
    case "setPolicyRate":
      return `Policy Rate ${(c.rate * 100).toFixed(1)}%`;
    case "setSpreads":
      return "rate spreads";
    case "setMarkup":
      return `${c.target} markup ${c.percent}%`;
    case "setTaxRates":
      return `tax rates (income ${c.income ?? "-"}%, corporate ${c.corporate ?? "-"}%)`;
    case "setResearch":
      return `research ${c.technologyIds.join(", ") || "none"}`;
    case "setPensionRate":
      return `pension rate ${c.rate}`;
    default:
      return `${c.type} ${c.amount}`;
  }
}

const noBorder = { border: 0, padding: 0 } as const;

export function Overview() {
  const worker = useRef<Worker | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState<string>();
  const [citizen, setCitizen] = useState<Citizen>();
  const [screen, setScreen] = useState<Screen>("overview");
  const [monetizeAmount, setMonetizeAmount] = useState(1000);
  const [grantAmount, setGrantAmount] = useState(100);
  const [loanAmount, setLoanAmount] = useState(1000);
  const [policyRate, setPolicyRate] = useState(3);
  const [retailSpread, setRetailSpread] = useState(15);
  const [incomeTax, setIncomeTax] = useState(0);
  const [corporateTax, setCorporateTax] = useState(0);
  const [pensionRate, setPensionRate] = useState(0);
  const [convertAmount, setConvertAmount] = useState(1000);
  const [grantCohort, setGrantCohort] = useState("cohort-0");
  const [debtAmount, setDebtAmount] = useState(1000);
  const [debtHolder, setDebtHolder] = useState("bank");

  useEffect(() => {
    const w = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (event: MessageEvent<FromWorker>) => {
      const message = event.data;
      if (message.type === "snapshot") {
        setSnapshot(message.snapshot);
      } else if (message.type === "citizen") {
        setCitizen(message.citizen);
      } else if (message.type === "saved") {
        try {
          localStorage.setItem("closed-loop-economy-save", message.save);
        } catch {
          setError("Could not save: browser storage is unavailable or full.");
        }
      } else {
        setError(message.message);
      }
    };
    worker.current = w;
    return () => w.terminate();
  }, []);

  const send = (message: ToWorker) => {
    setError(undefined);
    worker.current?.postMessage(message);
  };
  const cmd = (command: Command) => send({ type: "command", command });
  const load = () => {
    let save: string | null = null;
    try {
      save = localStorage.getItem("closed-loop-economy-save");
    } catch {
      // Treated the same as no save below.
    }
    if (save) send({ type: "load", save });
    else setError("No saved game found.");
  };

  if (!snapshot) return <p>Loading…</p>;
  const { tick, seed, speed, moneySupply, holders, log, cohorts, households, summary, industries, products, wageMarkup, bank, queued, fiscal, sectoral, flows, flowWindow, history, notes, stages, alerts, tutorial, durables, debt, burdens } = snapshot;
  const nextStep = tutorial.find((t) => !t.done);

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 800, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>{SCREENS.find((s) => s.id === screen)?.label}</h1>
      <nav aria-label="Screens">
        {SCREENS.map((s) => (
          <button key={s.id} disabled={s.id === screen} onClick={() => setScreen(s.id)}>{s.label}</button>
        ))}
      </nav>
      <p>
        Day {tick} · Seed {seed} · {speed === 0 ? "Paused" : `Running ${speed}x`} · Money supply {moneySupply.toLocaleString()}
      </p>

      <section>
        {SPEEDS.map((s) => (
          <button key={s.label} disabled={s.speed === speed} onClick={() => send({ type: "setSpeed", speed: s.speed })}>
            {s.label}
          </button>
        ))}{" "}
        <button disabled={speed !== 0} onClick={() => send({ type: "step" })}>
          Step 1 Tick
        </button>{" "}
        <button onClick={() => send({ type: "save" })}>Save</button> <button onClick={load}>Load</button>
      </section>

      {error && <p role="alert" style={{ color: "crimson" }}>{error}</p>}
      {alerts.map((a) => (
        <p key={a.id} role="alert" style={{ color: "darkorange", fontWeight: "bold" }}>{a.message}</p>
      ))}
      {queued.length > 0 && <p>Queued for the next Tick: {queued.map(describe).join(", ")}</p>}

      {screen === "overview" && (
        <>
          {nextStep && (
            <section aria-label="Tutorial">
              <h2>Getting started</h2>
              <ol>
                {tutorial.map((t) => (
                  <li key={t.id} style={{ textDecoration: t.done ? "line-through" : "none", fontWeight: t === nextStep ? "bold" : "normal" }}>{t.text}</li>
                ))}
              </ol>
              <p>The levers are on the Treasury and Central Bank screen. Taxes open on Day 10 and the Policy Rate on Day 40.</p>
            </section>
          )}
          <h2>Money supply: {moneySupply.toLocaleString()}</h2>
          <table>
            <thead>
              <tr><th align="left">Holder</th><th align="right">Balance</th></tr>
            </thead>
            <tbody>
              {holders.map((h) => (
                <tr key={h.holder}><td>{h.holder}</td><td align="right">{h.balance.toLocaleString()}</td></tr>
              ))}
            </tbody>
          </table>
          <h2>Sectoral Balance</h2>
          <table>
            <tbody>
              <tr><td>Government</td><td align="right">{sectoral.government.toLocaleString()}</td></tr>
              <tr><td>Households</td><td align="right">{sectoral.households.toLocaleString()}</td></tr>
              <tr><td>Industries</td><td align="right">{sectoral.industries.toLocaleString()}</td></tr>
              <tr><td>Commercial Banks</td><td align="right">{sectoral.commercialBanks.toLocaleString()}</td></tr>
            </tbody>
          </table>
          <h2>Money created and destroyed</h2>
          {log.length === 0 ? (
            <p>No money has been created or destroyed yet.</p>
          ) : (
            <ul>
              {[...log].reverse().map((e, i) => (
                <li key={i}>
                  Day {e.tick}: {e.amount.toLocaleString()} {e.direction} by {e.cause}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {screen === "flow" && (
        <Flows
          flows={flows}
          window={flowWindow}
          onWindow={(ticks) => send({ type: "setFlowWindow", ticks })}
          history={history}
          notes={notes}
          productNames={Object.fromEntries(products.map((p) => [p.id, p.name]))}
        />
      )}

      {screen === "industries" && (
        <>
          <Industries industries={industries} />
          <Locked open={stages.taxes} stage="Markup / Discount unlocks on Day 10" />
          <fieldset disabled={!stages.taxes} style={noBorder}>
            <Products products={products} wageMarkup={wageMarkup} onMarkup={(target, percent) => cmd({ type: "setMarkup", target, percent })} />
          </fieldset>
        </>
      )}

      {screen === "citizens" && (
        <>
          <Citizens households={households} summary={summary} citizen={citizen} onZoom={(cohortId) => send({ type: "zoom", cohortId })} />
          <h2>Houses and cars</h2>
          <table>
            <thead>
              <tr>
                <th align="left">Cohort</th><th align="right">Houses</th><th align="right">House value</th>
                <th align="right">Cars</th><th align="right">Car value</th><th align="right">Collateralised Loan</th>
              </tr>
            </thead>
            <tbody>
              {durables.map((d) => (
                <tr key={d.cohortId}>
                  <td>{cohorts.find((c) => c.id === d.cohortId)?.name ?? d.cohortId}</td>
                  <td align="right">{d.houses.toLocaleString()}</td>
                  <td align="right">{d.houseValue.toLocaleString()}</td>
                  <td align="right">{d.cars.toLocaleString()}</td>
                  <td align="right">{d.carValue.toLocaleString()}</td>
                  <td align="right">{d.securedDebt.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            Pension: {snapshot.pensionRate} per retiree per Tick (paid last Tick: {snapshot.pensionsPaid.toLocaleString()}). Set it on the Treasury and
            Central Bank screen.
          </p>
        </>
      )}

      {screen === "research" && (
        <Research research={snapshot.research} onChoose={(technologyIds) => cmd({ type: "setResearch", technologyIds })} />
      )}

      {screen === "treasury" && (
        <>
          <h2>Spending, loans and Monetization</h2>
          <p>
            <input type="number" min={1} value={monetizeAmount} onChange={(e) => setMonetizeAmount(Number(e.target.value))} />{" "}
            <button onClick={() => cmd({ type: "monetize", amount: monetizeAmount })}>Monetize</button>
          </p>
          <p>
            <input type="number" min={1} value={grantAmount} onChange={(e) => setGrantAmount(Number(e.target.value))} />{" "}
            <select value={grantCohort} onChange={(e) => setGrantCohort(e.target.value)}>
              {cohorts.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>{" "}
            <button onClick={() => cmd({ type: "grant", cohortId: grantCohort, amount: grantAmount })}>Grant</button>
          </p>
          <p>
            <input type="number" min={1} value={loanAmount} onChange={(e) => setLoanAmount(Number(e.target.value))} />{" "}
            <button onClick={() => cmd({ type: "industryLoan", industryId: "agriculture", amount: loanAmount })}>Industry Loan to Agriculture</button>
          </p>
          <p>
            <input type="number" min={1} value={convertAmount} onChange={(e) => setConvertAmount(Number(e.target.value))} />{" "}
            <button onClick={() => cmd({ type: "convertLoan", industryId: "agriculture", amount: convertAmount })}>
              Convert Agriculture loan to Equity Stake
            </button>
          </p>

          <h2>Taxes</h2>
          <Locked open={stages.taxes} stage="taxes, Government debt and pensions unlock on Day 10" />
          <fieldset disabled={!stages.taxes} style={noBorder}>
            <p>
              Income tax (%) <input type="number" min={0} max={100} value={incomeTax} onChange={(e) => setIncomeTax(Number(e.target.value))} />{" "}
              Corporate tax (%) <input type="number" min={0} max={100} value={corporateTax} onChange={(e) => setCorporateTax(Number(e.target.value))} />{" "}
              <button onClick={() => cmd({ type: "setTaxRates", income: incomeTax, corporate: corporateTax })}>Set tax rates</button>
            </p>
          </fieldset>
          <p>
            Rates {fiscal.rates.income}% income, {fiscal.rates.corporate}% corporate · Last Tick: income tax {fiscal.incomeTax.toLocaleString()}, corporate tax{" "}
            {fiscal.corporateTax.toLocaleString()}, dividends to Owner Cohort {fiscal.dividendsToOwners.toLocaleString()}, to Treasury{" "}
            {fiscal.dividendsToTreasury.toLocaleString()}, Household spending {fiscal.householdSpending.toLocaleString()}
          </p>

          <h2>Government debt</h2>
          <fieldset disabled={!stages.taxes} style={noBorder}>
            <p>
              <input type="number" min={1} value={debtAmount} onChange={(e) => setDebtAmount(Number(e.target.value))} />{" "}
              <select value={debtHolder} onChange={(e) => setDebtHolder(e.target.value)}>
                <option value="bank">Commercial Bank</option>
                <option value="centralBank">Central Bank (retire only)</option>
                {cohorts.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>{" "}
              <button onClick={() => cmd({ type: "issueDebt", holder: debtHolder, amount: debtAmount })}>Sell debt</button>{" "}
              <button onClick={() => cmd({ type: "retireDebt", holder: debtHolder, amount: debtAmount })}>Retire debt</button>
            </p>
          </fieldset>
          <p>
            Owed {debt.owed.toLocaleString()} · held by Central Bank {debt.centralBank.toLocaleString()}, Commercial Bank {debt.commercialBank.toLocaleString()},
            Households {debt.households.toLocaleString()}
          </p>
          <table>
            <caption style={{ textAlign: "left" }}>Debt burdens (real = in starting prices; price index {burdens.priceIndex.toFixed(2)})</caption>
            <thead>
              <tr><th align="left">Sector</th><th align="right">Nominal</th><th align="right">Real</th></tr>
            </thead>
            <tbody>
              {(["government", "industries", "households"] as const).map((k) => (
                <tr key={k}>
                  <td>{k}</td>
                  <td align="right">{burdens[k].nominal.toLocaleString()}</td>
                  <td align="right">{Math.round(burdens[k].real).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>Pensions</h2>
          <fieldset disabled={!stages.taxes} style={noBorder}>
            <p>
              Payout per retiree per Tick <input type="number" min={0} step={0.05} value={pensionRate} onChange={(e) => setPensionRate(Number(e.target.value))} />{" "}
              <button onClick={() => cmd({ type: "setPensionRate", rate: pensionRate })}>Set pension rate</button>
            </p>
          </fieldset>

          <h2>Commercial Bank</h2>
          <Locked open={stages.policyRate} stage="the Policy Rate unlocks on Day 40" />
          <fieldset disabled={!stages.policyRate} style={noBorder}>
            <p>
              Policy Rate (%) <input type="number" min={0} step={0.5} value={policyRate} onChange={(e) => setPolicyRate(Number(e.target.value))} />{" "}
              <button onClick={() => cmd({ type: "setPolicyRate", rate: policyRate / 100 })}>Set Policy Rate</button>
            </p>
            <p>
              Retail spread (%) <input type="number" min={0} step={0.5} value={retailSpread} onChange={(e) => setRetailSpread(Number(e.target.value))} />{" "}
              <button onClick={() => cmd({ type: "setSpreads", retail: retailSpread / 100 })}>Set spread</button>
            </p>
          </fieldset>
          <p>
            Policy Rate {(bank.policyRate * 100).toFixed(1)}% · Retail Credit {(bank.rates.retail * 100).toFixed(1)}% · Collateralised{" "}
            {(bank.rates.collateralised * 100).toFixed(1)}%
          </p>
          <p>
            Loans {bank.loans.toLocaleString()} · Deposits created {bank.deposits.toLocaleString()} · Equity {bank.equity.toLocaleString()} ·{" "}
            {bank.lending ? "Lending" : "Not lending (too little equity)"}
          </p>
        </>
      )}
    </main>
  );
}
