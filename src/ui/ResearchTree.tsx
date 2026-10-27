import { useState } from "react";
import type { Branch, ResearchView, TechnologyView } from "../sim";
import { compact, techColumns } from "./game";

export const BRANCHES: { id: Branch; name: string; icon: string }[] = [
  { id: "food", name: "Food", icon: "🌽" },
  { id: "materials-energy", name: "Materials and Energy", icon: "⚡" },
  { id: "industry", name: "Industry", icon: "⚙️" },
  { id: "society", name: "Society", icon: "🏛️" },
];

const STATUS_LABEL: Record<TechnologyView["status"], string> = {
  locked: "Locked",
  available: "Ready",
  active: "Researching",
  researched: "Discovered",
};

function perks(t: TechnologyView): string[] {
  return [
    ...t.unlocks.products.map((p) => `Unlocks ${p}`),
    ...t.unlocks.industries.map((i) => `Unlocks ${i}`),
    ...(t.bonus?.slots ? [`+${t.bonus.slots} Research slot`] : []),
    ...Object.entries(t.bonus?.yield ?? {}).map(([industry, share]) => `+${Math.round(share * 100)}% ${industry} output`),
  ];
}

/** The Technology tree, one branch per tab, read left to right by prerequisite depth. */
export function ResearchTree({ research, onChoose }: { research: ResearchView; onChoose: (technologyIds: string[]) => void }) {
  const [branch, setBranch] = useState<Branch>("food");
  const name = (id: string) => research.technologies.find((t) => t.id === id)?.name ?? id;
  const toggle = (t: TechnologyView) =>
    onChoose(t.status === "active" ? research.active.filter((id) => id !== t.id) : [...research.active, t.id]);
  const inBranch = (id: Branch) => research.technologies.filter((t) => t.branch === id);
  const columns = techColumns(inBranch(branch));
  return (
    <div className="research">
      <div className="research-stats">
        <div className="stat-chip"><b>{research.active.length}/{research.slots}</b><span>Research slots</span></div>
        <div className="stat-chip"><b>{research.scientists.toFixed(0)}</b><span>Scientists</span></div>
        <div className="stat-chip"><b>{research.pointsLastTick.toFixed(1)}</b><span>Points / day</span></div>
        <div className="stat-chip"><b>{research.contractPrice}</b><span>Treasury pays per point (up to {research.contractUnits}/day)</span></div>
      </div>
      <div className="tabs" role="tablist">
        {BRANCHES.map((b) => {
          const done = inBranch(b.id).filter((t) => t.status === "researched").length;
          return (
            <button key={b.id} role="tab" aria-selected={b.id === branch} className={b.id === branch ? "tab on" : "tab"} onClick={() => setBranch(b.id)}>
              {b.icon} {b.name} <small>{done}/{inBranch(b.id).length}</small>
            </button>
          );
        })}
      </div>
      <div className="tree">
        {columns.map((col, i) => (
          <div className="tree-col" key={i}>
            {col.map((t) => {
              const pct = Math.min(100, (t.progress / t.cost) * 100);
              return (
                <article key={t.id} className={`tech ${t.status}`}>
                  <h4>{t.name}</h4>
                  <div className="tech-status">{STATUS_LABEL[t.status]}</div>
                  <div className="bar"><i style={{ width: `${pct}%` }} /></div>
                  <div className="tech-cost">{compact(Math.floor(t.progress))} / {compact(t.cost)} pts</div>
                  {t.requires.length > 0 && <div className="tech-req">Needs {t.requires.map(name).join(", ")}</div>}
                  <ul className="perks">
                    {perks(t).map((p) => <li key={p}>{p}</li>)}
                  </ul>
                  {(t.status === "available" || t.status === "active") && (
                    <button className="btn small" onClick={() => toggle(t)}>{t.status === "active" ? "Stop" : "Research"}</button>
                  )}
                </article>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
