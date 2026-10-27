import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Citizen, Command } from "../sim";
import { Government } from "./Government";
import { Guide } from "./Guide";
import { Modal } from "./Modal";
import { ResearchTree } from "./ResearchTree";
import { Stage } from "./Stage";
import { Statistics } from "./Statistics";
import { Unlockables } from "./Unlockables";
import type { FromWorker, Snapshot, Speed, ToWorker } from "./protocol";
import "./game.css";

const SAVE_KEY = "closed-loop-economy-save";
const SPEEDS: { label: string; speed: Speed }[] = [
  { label: "⏸", speed: 0 },
  { label: "▶", speed: 1 },
  { label: "▶▶", speed: 2 },
  { label: "▶▶▶", speed: 4 },
];

interface Menu {
  id: string;
  icon: string;
  label: string;
  wide?: boolean;
}
const MENUS: Menu[] = [
  { id: "research", icon: "🔬", label: "Research", wide: true },
  { id: "unlocks", icon: "🔓", label: "Unlockables" },
  { id: "government", icon: "🏛️", label: "Government", wide: true },
  { id: "stats", icon: "📊", label: "Statistics", wide: true },
  { id: "guide", icon: "📖", label: "Guide" },
];

interface Toast {
  id: number;
  text: string;
}

export function App() {
  const worker = useRef<Worker | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [citizen, setCitizen] = useState<Citizen>();
  const [menu, setMenu] = useState<string>();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seen = useRef<{ done: Set<string>; stages: string } | undefined>(undefined);
  const toastId = useRef(0);

  const toast = (text: string) => {
    const id = toastId.current++;
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  };

  useEffect(() => {
    const w = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (event: MessageEvent<FromWorker>) => {
      const message = event.data;
      if (message.type === "snapshot") {
        const s = message.snapshot;
        const done = new Set(s.research.technologies.filter((t) => t.status === "researched").map((t) => t.id));
        const stages = Object.entries(s.stages).filter(([, open]) => open).map(([k]) => k).join(",");
        const before = seen.current;
        if (before) {
          for (const t of s.research.technologies) if (done.has(t.id) && !before.done.has(t.id)) toast(`🔬 Discovered ${t.name}!`);
          if (stages !== before.stages) toast("🔓 A new lever has unlocked: see Unlockables");
        }
        seen.current = { done, stages };
        setSnapshot(s);
      } else if (message.type === "citizen") {
        setCitizen(message.citizen);
      } else if (message.type === "saved") {
        try {
          localStorage.setItem(SAVE_KEY, message.save);
          toast("💾 Game saved");
        } catch {
          toast("⚠️ Could not save: browser storage is unavailable or full.");
        }
      } else {
        toast(`⚠️ ${message.message}`);
      }
    };
    worker.current = w;
    return () => w.terminate();
  }, []);

  const send = (message: ToWorker) => {
    worker.current?.postMessage(message);
  };
  const cmd = (command: Command) => send({ type: "command", command });
  const load = () => {
    let save: string | null = null;
    try {
      save = localStorage.getItem(SAVE_KEY);
    } catch {
      // Treated the same as no save below.
    }
    if (save) send({ type: "load", save });
    else toast("⚠️ No saved game found.");
  };

  if (!snapshot) return <div className="loading">🪙 Loading the economy…</div>;
  const { tick, speed, moneySupply } = snapshot;
  const open = MENUS.find((m) => m.id === menu);
  const pulse = (id: string) =>
    (id === "guide" && snapshot.tutorial.some((t) => !t.done) && tick < 3) ||
    (id === "research" && snapshot.research.active.length < snapshot.research.slots && snapshot.research.technologies.some((t) => t.status === "available"));

  const body: Record<string, ReactNode> = {
    research: <ResearchTree research={snapshot.research} onChoose={(technologyIds) => cmd({ type: "setResearch", technologyIds })} />,
    unlocks: <Unlockables stages={snapshot.stages} tick={tick} />,
    government: <Government snapshot={snapshot} cmd={cmd} />,
    stats: <Statistics snapshot={snapshot} citizen={citizen} send={send} cmd={cmd} />,
    guide: <Guide tutorial={snapshot.tutorial} />,
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">🪙 Closed-Loop <b>Economy</b></div>
        <div className="day">
          <small>Day</small>
          <strong>{tick}</strong>
        </div>
        <div className="speeds" role="group" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button key={s.speed} className={s.speed === speed ? "speed on" : "speed"} aria-label={s.speed === 0 ? "Pause" : `${s.speed}x`} onClick={() => send({ type: "setSpeed", speed: s.speed })}>{s.label}</button>
          ))}
          <button className="speed" disabled={speed !== 0} onClick={() => send({ type: "step" })} title="Step one day">⏭</button>
        </div>
        <div className="top-money" title="Money supply">🪙 {moneySupply.toLocaleString()}</div>
        <div className="saves">
          <button className="speed" onClick={() => send({ type: "save" })} title="Save">💾</button>
          <button className="speed" onClick={load} title="Load">📂</button>
        </div>
      </header>

      <div className="body">
        <main className="main"><Stage snapshot={snapshot} cmd={cmd} openMenu={setMenu} /></main>
        <nav className="rail" aria-label="Menus">
          {MENUS.map((m) => (
            <button key={m.id} className={`rail-btn${pulse(m.id) ? " pulse" : ""}`} onClick={() => setMenu(m.id)}>
              <span aria-hidden>{m.icon}</span>
              <small>{m.label}</small>
            </button>
          ))}
        </nav>
      </div>

      {open && <Modal title={open.label} icon={open.icon} wide={open.wide} onClose={() => setMenu(undefined)}>{body[open.id]}</Modal>}
      <div className="toasts" aria-live="polite">{toasts.map((t) => <div key={t.id} className="toast">{t.text}</div>)}</div>
    </div>
  );
}
