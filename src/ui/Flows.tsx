import type { Explanation, MoneyFlowView, TickStats } from "../sim";

const SECTORS = ["Government", "Households", "Industries", "Commercial Banks"];
const CREATION = "Money creation";
const DESTRUCTION = "Money destruction";
const COLORS = { normal: "#4a78b5", created: "#2e9d5b", destroyed: "#c0392b" };

const WINDOWS: { label: string; ticks: number }[] = [
  { label: "Last 10 Ticks", ticks: 10 },
  { label: "Last 30 Ticks", ticks: 30 },
  { label: "Last 100 Ticks", ticks: 100 },
  { label: "All time", ticks: 0 },
];

const WIDTH = 760;
const LX = 170;
const RX = 460;
const HEIGHT = 300;
const NODE_W = 14;

/** Bipartite Sankey: money givers on the left, receivers on the right, with creation and destruction highlighted. */
export function Sankey({ flows }: { flows: MoneyFlowView }) {
  const left = [CREATION, ...SECTORS];
  const right = [...SECTORS, DESTRUCTION];
  const out = (n: string) => flows.links.filter((l) => l.from === n).reduce((s, l) => s + l.amount, 0);
  const into = (n: string) => flows.links.filter((l) => l.to === n).reduce((s, l) => s + l.amount, 0);
  const total = Math.max(1, Math.max(left.reduce((s, n) => s + out(n), 0), right.reduce((s, n) => s + into(n), 0)));
  const gap = 12;
  const scale = (HEIGHT - gap * (left.length + 1)) / total;
  const place = (names: string[], size: (n: string) => number) => {
    const pos = new Map<string, { y: number; h: number }>();
    let y = gap;
    for (const n of names) {
      const h = Math.max(2, size(n) * scale);
      pos.set(n, { y, h });
      y += h + gap;
    }
    return pos;
  };
  const lp = place(left, out);
  const rp = place(right, into);
  const usedOut = new Map<string, number>();
  const usedIn = new Map<string, number>();
  const shown = [...flows.links].sort((a, b) => b.amount - a.amount);
  if (shown.length === 0) return <p>No money moved in this period.</p>;
  return (
    <svg viewBox={`0 0 ${WIDTH} ${Math.max(HEIGHT, ...[...lp.values(), ...rp.values()].map((p) => p.y + p.h + gap))}`} role="img" aria-label="Money flows between sectors" style={{ width: "100%", maxWidth: WIDTH }}>
      {shown.map((l, i) => {
        const a = lp.get(l.from);
        const b = rp.get(l.to);
        if (!a || !b) return null;
        const w = Math.max(1, l.amount * scale);
        const y1 = a.y + (usedOut.get(l.from) ?? 0) + w / 2;
        const y2 = b.y + (usedIn.get(l.to) ?? 0) + w / 2;
        usedOut.set(l.from, (usedOut.get(l.from) ?? 0) + w);
        usedIn.set(l.to, (usedIn.get(l.to) ?? 0) + w);
        const x1 = LX + NODE_W;
        const x2 = RX;
        const mid = (x1 + x2) / 2;
        const color = l.from === CREATION ? COLORS.created : l.to === DESTRUCTION ? COLORS.destroyed : COLORS.normal;
        return (
          <path key={i} d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`} fill="none" stroke={color} strokeWidth={w} opacity={0.5}>
            <title>{`${l.from} to ${l.to}: ${l.amount.toLocaleString()}`}</title>
          </path>
        );
      })}
      {left.map((n) => (
        <g key={`l-${n}`}>
          <rect x={LX} y={lp.get(n)!.y} width={NODE_W} height={lp.get(n)!.h} fill={n === CREATION ? COLORS.created : "#555"} />
          <text x={LX - 6} y={lp.get(n)!.y + lp.get(n)!.h / 2} textAnchor="end" dominantBaseline="middle" fontSize={12} fill="currentColor">
            {n} ({out(n).toLocaleString()})
          </text>
        </g>
      ))}
      {right.map((n) => (
        <g key={`r-${n}`}>
          <rect x={RX} y={rp.get(n)!.y} width={NODE_W} height={rp.get(n)!.h} fill={n === DESTRUCTION ? COLORS.destroyed : "#555"} />
          <text x={RX + NODE_W + 6} y={rp.get(n)!.y + rp.get(n)!.h / 2} dominantBaseline="middle" fontSize={12} fill="currentColor">
            {n} ({into(n).toLocaleString()})
          </text>
        </g>
      ))}
    </svg>
  );
}

interface Series {
  label: string;
  color: string;
  values: number[];
}

function LineChart({ title, ticks, series }: { title: string; ticks: number[]; series: Series[] }) {
  const w = 300;
  const h = 130;
  const pad = 28;
  const all = series.flatMap((s) => s.values);
  const lo = Math.min(0, ...all);
  const hi = Math.max(1, ...all);
  const x = (i: number) => pad + (ticks.length < 2 ? 0 : (i / (ticks.length - 1)) * (w - pad - 4));
  const y = (v: number) => h - 16 - ((v - lo) / (hi - lo)) * (h - 28);
  return (
    <figure style={{ margin: 0 }}>
      <figcaption style={{ fontWeight: 600 }}>{title}</figcaption>
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={title} style={{ width: "100%" }}>
        <line x1={pad} y1={h - 16} x2={w - 4} y2={h - 16} stroke="currentColor" opacity={0.3} />
        <text x={pad - 3} y={y(hi) + 4} textAnchor="end" fontSize={9} fill="currentColor">{Math.round(hi).toLocaleString()}</text>
        <text x={pad - 3} y={y(lo)} textAnchor="end" fontSize={9} fill="currentColor">{Math.round(lo).toLocaleString()}</text>
        <text x={pad} y={h - 3} fontSize={9} fill="currentColor">Day {ticks[0] ?? 0}</text>
        <text x={w - 4} y={h - 3} textAnchor="end" fontSize={9} fill="currentColor">Day {ticks.at(-1) ?? 0}</text>
        {series.map((s) => (
          <polyline key={s.label} fill="none" stroke={s.color} strokeWidth={1.5} points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
        ))}
      </svg>
      <div style={{ fontSize: 11 }}>
        {series.map((s) => (
          <span key={s.label} style={{ marginRight: 8 }}>
            <span style={{ color: s.color }}>&#9632;</span> {s.label}
          </span>
        ))}
      </div>
    </figure>
  );
}

const PALETTE = ["#4a78b5", "#2e9d5b", "#c0392b", "#d68910", "#8e44ad", "#16a085", "#7f8c8d", "#b9770e"];

export function Charts({ history, productNames }: { history: TickStats[]; productNames: Record<string, string> }) {
  if (history.length === 0) return <p>Charts appear after the first Tick.</p>;
  const ticks = history.map((p) => p.tick);
  const priced = Object.keys(productNames).filter((id) => history.some((p) => (p.prices[id] ?? 0) > 0));
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
      <LineChart title="Money supply" ticks={ticks} series={[{ label: "Money supply", color: PALETTE[0]!, values: history.map((p) => p.moneySupply) }]} />
      <LineChart
        title="Prices"
        ticks={ticks}
        series={priced.map((id, i) => ({ label: productNames[id]!, color: PALETTE[i % PALETTE.length]!, values: history.map((p) => p.prices[id] ?? 0) }))}
      />
      <LineChart title="Employment" ticks={ticks} series={[{ label: "Workers employed", color: PALETTE[1]!, values: history.map((p) => p.employment) }]} />
      <LineChart
        title="Welfare"
        ticks={ticks}
        series={[
          { label: "Health", color: PALETTE[1]!, values: history.map((p) => p.health) },
          { label: "Education", color: PALETTE[0]!, values: history.map((p) => p.education) },
          { label: "Hunger", color: PALETTE[3]!, values: history.map((p) => p.hunger) },
          { label: "Thirst", color: PALETTE[2]!, values: history.map((p) => p.thirst) },
        ]}
      />
    </div>
  );
}

export function Flows({
  flows,
  window,
  onWindow,
  history,
  notes,
  productNames,
}: {
  flows: MoneyFlowView;
  window: number;
  onWindow: (ticks: number) => void;
  history: TickStats[];
  notes: Explanation[];
  productNames: Record<string, string>;
}) {
  return (
    <section>
      <h2>Where money moved</h2>
      <p>
        Period{" "}
        <select value={window} onChange={(e) => onWindow(Number(e.target.value))}>
          {WINDOWS.map((w) => (
            <option key={w.ticks} value={w.ticks}>{w.label}</option>
          ))}
        </select>{" "}
        · <span style={{ color: COLORS.created }}>{flows.created.toLocaleString()} created</span> ·{" "}
        <span style={{ color: COLORS.destroyed }}>{flows.destroyed.toLocaleString()} destroyed</span>
      </p>
      <Sankey flows={flows} />
      <h2>Over time</h2>
      <Charts history={history} productNames={productNames} />
      <h2>Why things happened</h2>
      {notes.length === 0 ? (
        <p>Nothing notable yet.</p>
      ) : (
        <ul>
          {[...notes].reverse().slice(0, 30).map((n, i) => (
            <li key={i}>Day {n.tick}: {n.text}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
