import { balanceOf, post, type Ledger } from "./ledger";
import { industryAccounts, stockOf, take, unlockProducts, type Industry } from "./industry";
import technologyData from "./data/technologies.json";

export type Branch = "food" | "materials-energy" | "industry" | "society";

export interface TechnologyDef {
  id: string;
  name: string;
  branch: Branch;
  /** Research points needed. */
  cost: number;
  requires: string[];
  unlocks: { products: string[]; industries: string[] };
  /** Bonus on completion: extra active Research slots, and a share (0.2 is +20%) added to the output per worker of the named Industries. */
  bonus?: { slots?: number; yield?: Record<string, number> };
}

/** The Technology tree is defined in `data/technologies.json`. */
export const TECHNOLOGIES = technologyData as TechnologyDef[];

export const LAB_ID = "research-labs";
/** Active Technologies the player can research at once before any Technology adds slots. */
export const BASE_SLOTS = 1;
/** Units of Research the Government contracts to buy from the Labs each Tick while a Technology is active. */
export const CONTRACT_UNITS = 12;
/** What the Treasury pays the Labs per unit delivered; each unit is one research point. */
export const CONTRACT_PRICE = 30;

export interface ResearchState {
  /** Researched Technology ids. */
  done: string[];
  /** Technologies being researched, at most as many as there are slots. */
  active: string[];
  /** Points accumulated per Technology. */
  progress: Record<string, number>;
  /** Points the Labs delivered in the latest Tick. */
  delivered: number;
}

export const newResearch = (): ResearchState => ({ done: [], active: [], progress: {}, delivered: 0 });

export function technologyDef(id: string): TechnologyDef {
  const def = TECHNOLOGIES.find((t) => t.id === id);
  if (!def) throw new Error(`Unknown Technology ${id}`);
  return def;
}

export const slotsOf = (done: string[]) => BASE_SLOTS + done.reduce((s, id) => s + (technologyDef(id).bonus?.slots ?? 0), 0);

/** The extra output per worker, as a fraction, that the researched Technologies give an Industry. */
export const yieldBonusOf = (done: string[], industryId: string) =>
  done.reduce((s, id) => s + (technologyDef(id).bonus?.yield?.[industryId] ?? 0), 0);

/** Sets every Industry's yield bonus from the Technologies researched so far. */
export const applyYieldBonuses = (industries: Industry[], done: string[]): Industry[] =>
  industries.map((i) => ({ ...i, yieldBonus: yieldBonusOf(done, i.id) }));

/** Chooses the active Technologies, replacing the previous choice. Progress already made is kept. */
export function chooseActive(state: ResearchState, ids: string[]): ResearchState {
  const unique = [...new Set(ids)];
  for (const id of unique) {
    const def = technologyDef(id);
    if (state.done.includes(id)) throw new Error(`${def.name} is already researched`);
    const missing = def.requires.filter((r) => !state.done.includes(r));
    if (missing.length > 0) throw new Error(`${def.name} needs the prerequisite ${missing.map((m) => technologyDef(m).name).join(", ")}`);
  }
  const slots = slotsOf(state.done);
  if (unique.length > slots) throw new Error(`Only ${slots} Research slot${slots === 1 ? "" : "s"} available, got ${unique.length}`);
  return { ...state, active: unique };
}

const labLine = (industry: Industry) => industry.lines.find((l) => l.productId === "research");

/** Tells the Research Labs how much Research the Government will buy, so they plan to make it. */
export function contractDemand(industries: Industry[], state: ResearchState): Industry[] {
  const units = state.active.length > 0 ? CONTRACT_UNITS : 0;
  return industries.map((i) =>
    i.id !== LAB_ID ? i : { ...i, lines: i.lines.map((l) => (l.productId === "research" ? { ...l, contracted: units } : l)) },
  );
}

/**
 * The Government's Research contract for one Tick: the Treasury buys the Research the Labs have in
 * stock, up to the contract, and as much as it can pay for. Each unit bought is a point split between the
 * active Technologies. Completed Technologies unlock Products and slots.
 */
export function runContract(
  state: ResearchState,
  industries: Industry[],
  ledger: Ledger,
  tick: number,
): { state: ResearchState; industries: Industry[]; ledger: Ledger } {
  const lab = industries.find((i) => i.id === LAB_ID);
  const line = lab && labLine(lab);
  if (!lab || !line || !lab.started || lab.failed || state.active.length === 0) return { state: { ...state, delivered: 0 }, industries, ledger };
  const treasury = balanceOf(ledger, "treasury:money");
  const units = Math.min(CONTRACT_UNITS, Math.floor(stockOf(line)), Math.floor(treasury / CONTRACT_PRICE));
  if (units <= 0) return { state: { ...state, delivered: 0 }, industries, ledger };

  const paid = units * CONTRACT_PRICE;
  const acct = industryAccounts(lab);
  ledger = post(
    ledger,
    {
      type: "researchContract",
      entries: [
        { account: "treasury:equity", debit: paid },
        { account: "treasury:money", credit: paid },
        { account: acct.money, debit: paid },
        { account: acct.equity, credit: paid },
      ],
    },
    tick,
  ).ledger;
  let next = industries.map((i) =>
    i.id !== LAB_ID
      ? i
      : {
          ...i,
          revenue: i.revenue + paid,
          lines: i.lines.map((l) => (l.productId === "research" ? { ...l, batches: take(l.batches, units), sold: l.sold + units } : l)),
        },
  );

  const progress = { ...state.progress };
  const share = units / state.active.length;
  const finished: string[] = [];
  for (const id of state.active) {
    progress[id] = (progress[id] ?? 0) + share;
    if (progress[id]! >= technologyDef(id).cost - 1e-9) finished.push(id);
  }
  for (const id of finished) next = unlockProducts(next, technologyDef(id).unlocks.products);
  return {
    state: {
      done: [...state.done, ...finished],
      active: state.active.filter((id) => !finished.includes(id)),
      progress,
      delivered: units,
    },
    industries: next,
    ledger,
  };
}

export type TechnologyStatus = "researched" | "active" | "available" | "locked";

export interface TechnologyView extends TechnologyDef {
  progress: number;
  status: TechnologyStatus;
}

export interface ResearchView {
  slots: number;
  active: string[];
  technologies: TechnologyView[];
  /** Points delivered to the active Technologies in the latest Tick. */
  pointsLastTick: number;
  contractPrice: number;
  contractUnits: number;
  /** Scientists employed by the Research Labs, and how productive they are. */
  scientists: number;
  productivity: number;
}

export function researchView(state: ResearchState, industries: Industry[]): ResearchView {
  const lab = industries.find((i) => i.id === LAB_ID);
  return {
    slots: slotsOf(state.done),
    active: state.active,
    technologies: TECHNOLOGIES.map((t): TechnologyView => ({
      ...t,
      progress: state.done.includes(t.id) ? t.cost : state.progress[t.id] ?? 0,
      status: state.done.includes(t.id)
        ? "researched"
        : state.active.includes(t.id)
          ? "active"
          : t.requires.every((r) => state.done.includes(r))
            ? "available"
            : "locked",
    })),
    pointsLastTick: state.delivered,
    contractPrice: CONTRACT_PRICE,
    contractUnits: CONTRACT_UNITS,
    scientists: lab?.headcount ?? 0,
    productivity: lab?.productivity ?? 1,
  };
}
