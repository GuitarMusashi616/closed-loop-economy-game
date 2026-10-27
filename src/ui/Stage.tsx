import { useRef, useState } from "react";
import type { Command, IndustryView } from "../sim";
import { availableToSpend, compact, describeOrder, gaugeLevel } from "./game";
import type { Snapshot } from "./protocol";

const INDUSTRY_ICONS: Record<string, string> = {
  agriculture: "🌾",
  "mining-energy": "⛏️",
  manufacturing: "🏭",
  construction: "🏗️",
  "retail-logistics": "🛒",
  "healthcare-education": "🏥",
  "research-labs": "🔬",
  "advanced-energy": "⚡",
  "consumer-goods": "📦",
  electronics: "💻",
};
const COHORT_ICONS = { young: "🧒", established: "🧑‍🔧", retired: "🧓" } as const;
const DEALS = [100, 1_000, 10_000, 100_000];

function Gauge({ label, icon, value, better }: { label: string; icon: string; value: number; better: "high" | "low" }) {
  const level = gaugeLevel(value, better);
  return (
    <div className={`gauge ${level}`} title={`${label}: ${value.toFixed(0)} / 100`}>
      <span className="gauge-label">{icon} {label}</span>
      <div className="bar"><i style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>
      <span className="gauge-value">{value.toFixed(0)}</span>
    </div>
  );
}

function IndustryCard({ industry, deal, canAfford, onFund }: { industry: IndustryView; deal: number; canAfford: boolean; onFund: () => void }) {
  const status = !industry.started ? "idle" : industry.failed ? "failed" : "running";
  const staffed = industry.targetHeadcount > 0 ? Math.min(100, (industry.workers / industry.targetHeadcount) * 100) : 0;
  return (
    <article className={`card industry ${status}`}>
      <div className="card-icon" aria-hidden>{INDUSTRY_ICONS[industry.id] ?? "🏢"}</div>
      <div className="card-main">
        <h4>{industry.name}</h4>
        <div className="card-sub">
          {status === "idle" && "Waiting for a loan"}
          {status === "failed" && `Collapsed · ${industry.laidOff.toLocaleString()} jobs lost`}
          {status === "running" && `👷 ${compact(Math.round(industry.workers))} workers · 🪙 ${compact(industry.money)}`}
        </div>
        {status === "running" && <div className="bar"><i style={{ width: `${staffed}%` }} /></div>}
        {industry.loanOwed > 0 && <div className="card-sub">Owes {compact(industry.loanOwed)}</div>}
      </div>
      <button className="btn small" disabled={!canAfford} title={canAfford ? undefined : "Not enough in the Treasury: Monetize first"} onClick={onFund}>{status === "idle" ? "Open" : status === "failed" ? "Restart" : "Fund"} {compact(deal)}</button>
    </article>
  );
}

/** The main screen: everything the core loop needs. Mint money, fund Industries, support Households, read the vitals. */
export function Stage({ snapshot, cmd, openMenu }: { snapshot: Snapshot; cmd: (c: Command) => void; openMenu: (id: string) => void }) {
  const { holders, moneySupply, gdp, priceIndex, summary, industries, households, history, alerts, tutorial, queued, speed } = snapshot;
  const [deal, setDeal] = useState(1_000);
  const [floaters, setFloaters] = useState<{ id: number; text: string; x: number }[]>([]);
  const nextId = useRef(0);
  const nextStep = tutorial.find((t) => !t.done);
  const spendable = availableToSpend(holders.find((h) => h.holder === "Treasury")?.balance ?? 0, queued);
  const canAfford = spendable >= deal;
  const employed = history.at(-1)?.employment ?? 0;

  const mint = () => {
    cmd({ type: "monetize", amount: deal });
    const id = nextId.current++;
    setFloaters((f) => [...f, { id, text: `+${compact(deal)}`, x: Math.random() * 80 - 40 }]);
    setTimeout(() => setFloaters((f) => f.filter((x) => x.id !== id)), 1200);
  };
  const grant = (cohortId: string, name: string) => {
    cmd({ type: "grant", cohortId, amount: deal });
    const id = nextId.current++;
    setFloaters((f) => [...f, { id, text: `🎁 ${name}`, x: 0 }]);
    setTimeout(() => setFloaters((f) => f.filter((x) => x.id !== id)), 1200);
  };

  return (
    <div className="stage">
      <section className="hero">
        <div className="hero-money">
          <small>Money supply</small>
          <div className="counter" aria-live="off">🪙 {moneySupply.toLocaleString()}</div>
          <div className="hero-stats">
            <span title="Final sales last day">📈 GDP {compact(gdp)}</span>
            <span title="1.00 at the start">🏷️ Prices ×{priceIndex.toFixed(2)}</span>
            <span>💼 {compact(employed)} employed</span>
            <span>👥 {compact(summary.population)} citizens</span>
            <span title="Cash the Treasury can spend once queued orders land">🏛️ Treasury {compact(spendable)}</span>
          </div>
        </div>
        <div className="mint">
          <button className={`coin${queued.length ? " pending" : ""}`} onClick={mint} aria-label={`Monetize ${deal}`}>
            <span>🪙</span>
            <small>MINT {compact(deal)}</small>
          </button>
          {floaters.map((f) => <span key={f.id} className="floater" style={{ left: `calc(50% + ${f.x}px)` }}>{f.text}</span>)}
          <div className="chips" role="group" aria-label="Deal size">
            {DEALS.map((d) => (
              <button key={d} className={d === deal ? "chip on" : "chip"} onClick={() => setDeal(d)}>{compact(d)}</button>
            ))}
          </div>
          <p className="hint">
            {queued.length > 0 ? `Queued for the next day: ${queued.map(describeOrder).join(", ")}` : speed === 0 ? "Paused: orders land when you step or run." : "The Central Bank creates new money."}
          </p>
        </div>
      </section>

      {alerts.map((a) => <div key={a.id} className="alert" role="alert">⚠️ {a.message}</div>)}

      <div className="stage-grid">
        <div className="stage-main">
          <h3 className="section-title">🏭 Industries <small>Fund them so they hire and produce</small></h3>
          <div className="cards">
            {industries.map((i) => (
              <IndustryCard key={i.id} industry={i} deal={deal} canAfford={canAfford} onFund={() => cmd({ type: "industryLoan", industryId: i.id, amount: deal })} />
            ))}
          </div>
          <h3 className="section-title">🏠 Households <small>Grants give them money to buy food</small></h3>
          <div className="cards">
            {households.map((c) => (
              <article key={c.id} className="card household">
                <div className="card-icon" aria-hidden>{COHORT_ICONS[c.ageBand]}</div>
                <div className="card-main">
                  <h4>{c.name}</h4>
                  <div className="card-sub">👥 {compact(c.population)} · 🪙 {compact(c.wealth)} each</div>
                  <Gauge label="Fed" icon="🍞" value={100 - c.hunger} better="high" />
                  <Gauge label="Health" icon="❤️" value={c.health} better="high" />
                </div>
                <button className="btn small" disabled={c.population === 0 || !canAfford} title={canAfford ? undefined : "Not enough in the Treasury: Monetize first"} onClick={() => grant(c.id, c.name)}>Grant {compact(deal)}</button>
              </article>
            ))}
          </div>
        </div>

        <aside className="stage-side">
          {nextStep && (
            <section className="quest">
              <h3>📜 Next quest</h3>
              <p>{nextStep.text}</p>
              <button className="link" onClick={() => openMenu("guide")}>Open the guide →</button>
            </section>
          )}
          <section className="panel vitals">
            <h3>🇺🇳 The nation</h3>
            <Gauge label="Fed" icon="🍞" value={100 - summary.hunger} better="high" />
            <Gauge label="Hydrated" icon="💧" value={100 - summary.thirst} better="high" />
            <Gauge label="Health" icon="❤️" value={summary.health} better="high" />
            <Gauge label="Housed" icon="🏠" value={100 - summary.homelessness * 100} better="high" />
            <Gauge label="Educated" icon="🎓" value={summary.education} better="high" />
            <div className="card-sub">☠️ {compact(summary.deaths)} died · 🛫 {compact(summary.emigrated)} left · 🛬 {compact(summary.immigrated)} arrived</div>
          </section>
        </aside>
      </div>
    </div>
  );
}
