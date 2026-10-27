import { useEffect, useRef, useState } from "react";
import { Industries } from "./Industries";
import type { FromWorker, Snapshot, Speed, ToWorker } from "./protocol";

const SPEEDS: { label: string; speed: Speed }[] = [
  { label: "Pause", speed: 0 },
  { label: "1x", speed: 1 },
  { label: "2x", speed: 2 },
  { label: "4x", speed: 4 },
];

export function Overview() {
  const worker = useRef<Worker | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [error, setError] = useState<string>();
  const [monetizeAmount, setMonetizeAmount] = useState(1000);
  const [grantAmount, setGrantAmount] = useState(100);
  const [loanAmount, setLoanAmount] = useState(1000);
  const [grantCohort, setGrantCohort] = useState("cohort-0");

  useEffect(() => {
    const w = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (event: MessageEvent<FromWorker>) => {
      const message = event.data;
      if (message.type === "snapshot") {
        setSnapshot(message.snapshot);
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
  const { tick, seed, speed, moneySupply, holders, log, cohorts, industries, queued } = snapshot;

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
      {queued.length > 0 && (
        <p>Queued for the next Tick: {queued.map((c) => `${c.type} ${c.amount}`).join(", ")}</p>
      )}

      <Industries industries={industries} />

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
