import { useEffect, useRef, useState } from "react";
import type { Command } from "../sim";
import { Citizens } from "./Citizens";
import { Flows } from "./Flows";
import { Industries } from "./Industries";
import { Products } from "./Products";
import type { Citizen } from "../sim";
import type { FromWorker, Snapshot, Speed, ToWorker } from "./protocol";

const SPEEDS: { label: string; speed: Speed }[] = [
  { label: "Pause", speed: 0 },
  { label: "1x", speed: 1 },
  { label: "2x", speed: 2 },
  { label: "4x", speed: 4 },
];

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
    default:
      return `${c.type} ${c.amount}`;
  }
}

export function Overview() {
  const worker = useRef<Worker | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState<string>();
  const [citizen, setCitizen] = useState<Citizen>();
  const [monetizeAmount, setMonetizeAmount] = useState(1000);
  const [grantAmount, setGrantAmount] = useState(100);
  const [loanAmount, setLoanAmount] = useState(1000);
  const [policyRate, setPolicyRate] = useState(3);
  const [retailSpread, setRetailSpread] = useState(15);
  const [incomeTax, setIncomeTax] = useState(0);
  const [corporateTax, setCorporateTax] = useState(0);
  const [convertAmount, setConvertAmount] = useState(1000);
  const [grantCohort, setGrantCohort] = useState("cohort-0");

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
  const { tick, seed, speed, moneySupply, holders, log, cohorts, households, summary, industries, products, wageMarkup, bank, queued, fiscal, sectoral, flows, flowWindow, history, notes } = snapshot;

  return (
    <main style={{ fontFamily: "system-ui", maxWidth: 800, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>Overview</h1>
      <p>
        Day {tick} · Seed {seed} · {speed === 0 ? "Paused" : `Running ${speed}x`}
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

      <h2>Government levers</h2>
      <p>
        <input type="number" min={1} value={monetizeAmount} onChange={(e) => setMonetizeAmount(Number(e.target.value))} />{" "}
        <button onClick={() => send({ type: "command", command: { type: "monetize", amount: monetizeAmount } })}>Monetize</button>
      </p>
      <p>
        <input type="number" min={1} value={grantAmount} onChange={(e) => setGrantAmount(Number(e.target.value))} />{" "}
        <select value={grantCohort} onChange={(e) => setGrantCohort(e.target.value)}>
          {cohorts.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>{" "}
        <button onClick={() => send({ type: "command", command: { type: "grant", cohortId: grantCohort, amount: grantAmount } })}>
          Grant
        </button>
      </p>
      <p>
        <input type="number" min={1} value={loanAmount} onChange={(e) => setLoanAmount(Number(e.target.value))} />{" "}
        <button onClick={() => send({ type: "command", command: { type: "industryLoan", industryId: "agriculture", amount: loanAmount } })}>
          Industry Loan to Agriculture
        </button>
      </p>
      <p>
        <input type="number" min={1} value={convertAmount} onChange={(e) => setConvertAmount(Number(e.target.value))} />{" "}
        <button onClick={() => send({ type: "command", command: { type: "convertLoan", industryId: "agriculture", amount: convertAmount } })}>
          Convert Agriculture loan to Equity Stake
        </button>
      </p>
      <h2>Taxes</h2>
      <p>
        Income tax (%) <input type="number" min={0} max={100} value={incomeTax} onChange={(e) => setIncomeTax(Number(e.target.value))} />{" "}
        Corporate tax (%) <input type="number" min={0} max={100} value={corporateTax} onChange={(e) => setCorporateTax(Number(e.target.value))} />{" "}
        <button onClick={() => send({ type: "command", command: { type: "setTaxRates", income: incomeTax, corporate: corporateTax } })}>Set tax rates</button>
      </p>
      <p>
        Rates {fiscal.rates.income}% income, {fiscal.rates.corporate}% corporate · Last Tick: income tax {fiscal.incomeTax.toLocaleString()}, corporate tax{" "}
        {fiscal.corporateTax.toLocaleString()}, dividends to Owner Cohort {fiscal.dividendsToOwners.toLocaleString()}, to Treasury{" "}
        {fiscal.dividendsToTreasury.toLocaleString()}, Household spending {fiscal.householdSpending.toLocaleString()}
      </p>
      <h2>Sectoral Balance</h2>
      <table>
        <tbody>
          <tr><td>Government</td><td align="right">{sectoral.government.toLocaleString()}</td></tr>
          <tr><td>Households</td><td align="right">{sectoral.households.toLocaleString()}</td></tr>
          <tr><td>Industries</td><td align="right">{sectoral.industries.toLocaleString()}</td></tr>
          <tr><td>Commercial Banks</td><td align="right">{sectoral.commercialBanks.toLocaleString()}</td></tr>
        </tbody>
      </table>
      <h2>Commercial Bank</h2>
      <p>
        Policy Rate (%) <input type="number" min={0} step={0.5} value={policyRate} onChange={(e) => setPolicyRate(Number(e.target.value))} />{" "}
        <button onClick={() => send({ type: "command", command: { type: "setPolicyRate", rate: policyRate / 100 } })}>Set Policy Rate</button>
      </p>
      <p>
        Retail spread (%) <input type="number" min={0} step={0.5} value={retailSpread} onChange={(e) => setRetailSpread(Number(e.target.value))} />{" "}
        <button onClick={() => send({ type: "command", command: { type: "setSpreads", retail: retailSpread / 100 } })}>Set spread</button>
      </p>
      <p>
        Policy Rate {(bank.policyRate * 100).toFixed(1)}% · Retail Credit {(bank.rates.retail * 100).toFixed(1)}% · Collateralised{" "}
        {(bank.rates.collateralised * 100).toFixed(1)}%
      </p>
      <p>
        Loans {bank.loans.toLocaleString()} · Deposits created {bank.deposits.toLocaleString()} · Equity {bank.equity.toLocaleString()} ·{" "}
        {bank.lending ? "Lending" : "Not lending (too little equity)"}
      </p>
      {queued.length > 0 && <p>Queued for the next Tick: {queued.map(describe).join(", ")}</p>}

      <Flows
        flows={flows}
        window={flowWindow}
        onWindow={(ticks) => send({ type: "setFlowWindow", ticks })}
        history={history}
        notes={notes}
        productNames={Object.fromEntries(products.map((p) => [p.id, p.name]))}
      />

      <Industries industries={industries} />
      <Products
        products={products}
        wageMarkup={wageMarkup}
        onMarkup={(target, percent) => send({ type: "command", command: { type: "setMarkup", target, percent } })}
      />

      <Citizens
        households={households}
        summary={summary}
        citizen={citizen}
        onZoom={(cohortId) => send({ type: "zoom", cohortId })}
      />

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
    </main>
  );
}
