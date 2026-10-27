import { UNLOCK_TICK, type Command, type LeverStages, type TechnologyView } from "../sim";

const SUFFIXES = ["", "K", "M", "B", "T"];

/** 1500 → "1.5K", for counters that must stay short. */
export function compact(n: number): string {
  const sign = n < 0 ? "-" : "";
  let value = Math.abs(n);
  let i = 0;
  while (value >= 1000 && i < SUFFIXES.length - 1) {
    value /= 1000;
    i++;
  }
  const text = i === 0 ? String(Math.round(value)) : String(Math.round(value * 10) / 10);
  return `${sign}${text}${SUFFIXES[i]}`;
}

export type GaugeLevel = "good" | "warn" | "bad";

const GOOD_AT = 70;
const BAD_BELOW = 30;

/** Colours a 0-100 stat; "low" is for stats such as hunger where lower is better. */
export function gaugeLevel(value: number, better: "high" | "low"): GaugeLevel {
  const score = better === "high" ? value : 100 - value;
  return score >= GOOD_AT ? "good" : score < BAD_BELOW ? "bad" : "warn";
}

/** Splits a branch's Technologies into columns by prerequisite depth, so the tree reads left to right. */
export function techColumns(techs: TechnologyView[]): TechnologyView[][] {
  const byId = new Map(techs.map((t) => [t.id, t]));
  const depth = new Map<string, number>();
  const depthOf = (t: TechnologyView): number => {
    const known = depth.get(t.id);
    if (known !== undefined) return known;
    const d = Math.max(-1, ...t.requires.map((id) => (byId.has(id) ? depthOf(byId.get(id)!) : -1))) + 1;
    depth.set(t.id, d);
    return d;
  };
  const columns: TechnologyView[][] = [];
  for (const t of techs) (columns[depthOf(t)] ??= []).push(t);
  return columns.filter(Boolean);
}

export interface Unlockable {
  id: keyof LeverStages;
  name: string;
  /** What opening it gives the player. */
  gives: string;
  open: boolean;
  /** Days until it opens, 0 once open. */
  daysLeft: number;
}

const STAGE_INFO: { id: keyof LeverStages; name: string; gives: string }[] = [
  { id: "basics", name: "Basic levers", gives: "Monetization, Grants, Industry Loans, Equity Stakes and Research." },
  { id: "taxes", name: "Taxes and Debt", gives: "Income and corporate tax, Government debt, pensions, public funding of healthcare and education, and Markup / Discount on Products." },
  { id: "policyRate", name: "Central Bank", gives: "The Policy Rate and the Commercial Bank's lending spreads." },
];

export function unlockables(stages: LeverStages, tick: number): Unlockable[] {
  return STAGE_INFO.map((s) => ({ ...s, open: stages[s.id], daysLeft: stages[s.id] ? 0 : Math.max(0, UNLOCK_TICK[s.id] - tick) }));
}

/** What the Treasury can still spend once the queued orders land: a Grant or Loan past this would reject the whole batch. */
export function availableToSpend(treasury: number, queued: Command[]): number {
  return queued.reduce((cash, c) => {
    if (c.type === "monetize") return cash + c.amount;
    if (c.type === "grant" || c.type === "industryLoan") return cash - c.amount;
    return cash;
  }, treasury);
}

/** A short phrase for a queued order, shown while it waits for the next day. */
export function describeOrder(c: Command): string {
  switch (c.type) {
    case "monetize":
      return `Monetize ${compact(c.amount)}`;
    case "grant":
      return `Grant ${compact(c.amount)}`;
    case "industryLoan":
      return `Loan ${compact(c.amount)} to ${c.industryId}`;
    case "setResearch":
      return `Research ${c.technologyIds.join(", ") || "nothing"}`;
    case "setPolicyRate":
      return `Policy Rate ${(c.rate * 100).toFixed(1)}%`;
    case "setMarkup":
      return `${c.target} markup ${c.percent}%`;
    default:
      return c.type;
  }
}
