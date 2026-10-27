import { post, type Ledger, type MoneyEvent, type Transaction } from "./ledger";
import { GRAIN_NEED_PER_HEAD } from "./households";
import { clearAuction, type Buyer } from "./market";
import { applyMarkup, productDef, tierBudget, type Tastes } from "./products";
import industryData from "./data/industries.json";

/** One Product an Industry sells, with its stock, asking price and the results of the latest Tick. */
export interface ProductLine {
  productId: string;
  /** Units each worker makes of this Product per Tick. */
  yield: number;
  /** Stock by age in Ticks: `batches[0]` was made this Tick. Stock is physical and not on the ledger. */
  batches: number[];
  /** The price the Industry asks, learned from whether yesterday's stock sold out. */
  ask: number;
  /** Units of other Products used to make one unit of this one (the recipe). */
  inputs: Record<string, number>;
  /** Capacity needed to make one unit. */
  capacityPerUnit: number;
  /** Units the Industry meant to make this Tick, set when it bought its inputs. */
  plan: number;
  /** Units other Industries are expected to want per Tick, a running average of what they asked for. */
  expected: number;
  // Results of the latest Tick, for display.
  produced: number;
  sold: number;
  demand: number;
  spoiled: number;
  /** The price buyers paid, after any Markup / Discount. */
  price: number;
}

export interface Industry {
  id: string;
  name: string;
  /** Becomes true on the first Industry Loan; nothing happens before. */
  started: boolean;
  lines: ProductLine[];
  wage: number;
  targetHeadcount: number;
  /** Product the Industry buys as capital goods to replace its Capacity. */
  capitalGood: string;
  /** Production capital, bought as capital goods and lost to depreciation. */
  capacity: number;
  /** The plant that never wears out entirely, so a failed supply chain can recover. */
  baseCapacity: number;
  /** Inputs bought and not yet used. Physical, not on the ledger. */
  inputStock: Record<string, number>;
  startHeadcount: number;
  /** True once the Industry has failed; a new Industry Loan restarts it. */
  failed: boolean;
  /** Consecutive Ticks the Industry could not afford a single worker. */
  brokeTicks: number;
  /** Jobs lost when it failed, and the debt written off. */
  laidOff: number;
  writtenOff: number;
  // Results of the latest Tick, for display.
  headcount: number;
  wagesPaid: number;
  /** Sales income and running costs (wages and inputs) of the latest Tick. */
  revenue: number;
  costs: number;
}

export interface IndustryView extends Industry {
  money: number;
  loanOwed: number;
  equity: number;
  /** The Government's Equity Stake, converted from its Industry Loan. */
  stake: number;
}

export const WORKER_COHORT = "cohort-0";

export const stockOf = (line: ProductLine) => line.batches.reduce((s, n) => s + n, 0);

interface IndustryDef {
  id: string;
  name: string;
  wage: number;
  startHeadcount: number;
  capitalGood: string;
  lines: { productId: string; yield: number; ask: number; capacityPerUnit: number; inputs: Record<string, number> }[];
}

/** The seven starting Industries, with their recipes, are defined in `data/industries.json`. */
const DEFS = industryData as IndustryDef[];

/** Share of Capacity lost to depreciation each Tick. */
export const DEPRECIATION = 0.05;
/** Industries try to hold this much Capacity relative to what their target headcount needs. */
const CAPACITY_BUFFER = 1.5;
const STARTING_CAPACITY = 1.3;
const BASE_CAPACITY = 0.25;
const STOCK_BUFFER = 1.1;
const BROKE_AFTER = 5;

const capacityPerWorker = (lines: { yield: number; capacityPerUnit: number }[]) =>
  lines.reduce((s, l) => s + l.yield * l.capacityPerUnit, 0);

function build(def: IndustryDef): Industry {
  return {
    id: def.id,
    name: def.name,
    started: false,
    lines: def.lines.map((l) => ({
      productId: l.productId, yield: l.yield, inputs: l.inputs, capacityPerUnit: l.capacityPerUnit, plan: 0, expected: 0,
      batches: [], ask: l.ask, produced: 0, sold: 0, demand: 0, spoiled: 0, price: 0,
    })),
    wage: def.wage,
    targetHeadcount: def.startHeadcount,
    capitalGood: def.capitalGood,
    capacity: Math.ceil(STARTING_CAPACITY * capacityPerWorker(def.lines) * def.startHeadcount),
    baseCapacity: Math.ceil(BASE_CAPACITY * capacityPerWorker(def.lines) * def.startHeadcount),
    inputStock: {},
    startHeadcount: def.startHeadcount,
    failed: false,
    brokeTicks: 0,
    laidOff: 0,
    writtenOff: 0,
    headcount: 0,
    wagesPaid: 0,
    revenue: 0,
    costs: 0,
  };
}

/** The ask an Industry opened with for a Product, the base for the price index. */
export function startingAsk(industryId: string, productId: string): number {
  return DEFS.find((d) => d.id === industryId)?.lines.find((l) => l.productId === productId)?.ask ?? 1;
}

/** The wage an Industry opened with. */
export function startingWage(industryId: string): number {
  return DEFS.find((d) => d.id === industryId)?.wage ?? 1;
}

export function newIndustries(): Industry[] {
  return DEFS.map(build);
}

/** Starts an Industry on an Industry Loan; a failed one comes back fresh. */
export function startIndustry(industry: Industry): Industry {
  if (!industry.failed) return { ...industry, started: true };
  const fresh = build(DEFS.find((d) => d.id === industry.id)!);
  return { ...fresh, started: true, writtenOff: industry.writtenOff };
}

export function industryAccounts(industry: Industry) {
  return {
    money: `${industry.id}:money`,
    loanOwed: `${industry.id}:loanOwed`,
    equity: `${industry.id}:equity`,
  };
}

function balance(ledger: Ledger, account: string): number {
  return ledger.balances[account] ?? 0;
}

/** Ages stock by a Tick and throws away what has outlived the Product's shelf life. */
function age(line: ProductLine): { batches: number[]; spoiled: number } {
  const shelfLife = productDef(line.productId).shelfLife;
  const aged = [0, ...line.batches];
  if (shelfLife === null) return { batches: aged, spoiled: 0 };
  const spoiled = aged.slice(shelfLife).reduce((s, n) => s + n, 0);
  return { batches: aged.slice(0, shelfLife), spoiled };
}

/** The ask is marked down by up to half as the oldest stock approaches its shelf life. */
export function askFor(line: ProductLine, batches: number[]): number {
  const shelfLife = productDef(line.productId).shelfLife;
  const oldest = batches.reduce((o, n, i) => (n > 0 ? i : o), 0);
  if (shelfLife === null) return line.ask;
  return Math.max(1, Math.floor(line.ask * (1 - (0.5 * oldest) / shelfLife)));
}

/** Removes `units` from stock, oldest first. */
export function take(batches: number[], units: number): number[] {
  const next = [...batches];
  for (let i = next.length - 1; i >= 0 && units > 0; i--) {
    const taken = Math.min(next[i]!, units);
    next[i]! -= taken;
    units -= taken;
  }
  return next;
}

export interface MarketInputs {
  cohorts: { id: string; population: number; hunger: number }[];
  tastes: Tastes;
  /** Player Markup / Discount in percent by Product id, and by "wages". */
  markups: Record<string, number>;
  /** Income tax in percent, taken from wages as they are paid. */
  incomeTax: number;
}

/** Units of a line the Industry means to make: whatever sells to Households, or what other Industries asked for. */
export function planFor(industry: Industry, line: ProductLine): number {
  const capacity = industry.targetHeadcount * line.yield;
  if (productDef(line.productId).household) return capacity;
  const glut = stockOf(line) > 2 * line.expected;
  return glut ? 0 : Math.min(capacity, Math.ceil(STOCK_BUFFER * line.expected));
}

/** Capacity the Industry wants to hold, a buffer above what its target headcount uses. */
export const capacityWanted = (industry: Industry) =>
  Math.ceil(CAPACITY_BUFFER * industry.targetHeadcount * capacityPerWorker(industry.lines));

/** How many units each line can make from the inputs and Capacity on hand, given a limit on what workers can make. */
function allowances(industry: Industry, workerCap: (line: ProductLine) => number): number[] {
  const stock = { ...industry.inputStock };
  let room = industry.capacity;
  return industry.lines.map((line) => {
    let units = Math.min(line.plan, workerCap(line));
    for (const [id, per] of Object.entries(line.inputs)) units = Math.min(units, Math.floor((stock[id] ?? 0) / per + 1e-9));
    if (line.capacityPerUnit > 0) units = Math.min(units, Math.floor(room / line.capacityPerUnit));
    units = Math.max(0, units);
    for (const [id, per] of Object.entries(line.inputs)) stock[id] = (stock[id] ?? 0) - units * per;
    room -= units * line.capacityPerUnit;
    return units;
  });
}

/** One Tick of an Industry: hire and pay wages, produce, then sell each Product at its call auction. */
export function runIndustry(
  industry: Industry,
  ledger: Ledger,
  inputs: MarketInputs,
  tick: number,
): { industry: Industry; ledger: Ledger; events: MoneyEvent[]; fills: Record<string, number>; incomeTax: number; householdSpending: number } {
  if (!industry.started) return { industry, ledger, events: [], fills: {}, incomeTax: 0, householdSpending: 0 };
  const acct = industryAccounts(industry);
  const events: MoneyEvent[] = [];
  const apply = (tx: Transaction) => {
    const result = post(ledger, tx, tick);
    ledger = result.ledger;
    if (result.event) events.push(result.event);
  };
  const { cohorts, tastes, markups } = inputs;
  let incomeTax = 0;

  // The wage is discovered first, then the player's Markup / Discount applies on top.
  // Only as many workers are hired as there are inputs and Capacity to keep busy, and money to pay.
  const wage = applyMarkup(industry.wage, markups.wages);
  const unlimited = allowances(industry, () => Infinity);
  const needed = industry.lines.reduce((m, l, i) => Math.max(m, Math.ceil(unlimited[i]! / l.yield)), 0);
  const headcount = Math.min(industry.targetHeadcount, needed, Math.floor(balance(ledger, acct.money) / wage));
  const wagesPaid = headcount * wage;
  if (wagesPaid > 0) {
    apply({
      type: "wages",
      entries: [
        { account: acct.equity, debit: wagesPaid },
        { account: acct.money, credit: wagesPaid },
        { account: `${WORKER_COHORT}:money`, debit: wagesPaid },
        { account: `${WORKER_COHORT}:equity`, credit: wagesPaid },
      ],
    });
    // Income tax is taken as wages are paid, so it is gone before workers go shopping.
    incomeTax = Math.min(Math.floor((wagesPaid * inputs.incomeTax) / 100), balance(ledger, `${WORKER_COHORT}:money`));
    if (incomeTax > 0) {
      apply({
        type: "incomeTax",
        entries: [
          { account: `${WORKER_COHORT}:equity`, debit: incomeTax },
          { account: `${WORKER_COHORT}:money`, credit: incomeTax },
          { account: "treasury:money", debit: incomeTax },
          { account: "treasury:equity", credit: incomeTax },
        ],
      });
    }
  }

  // Produce from inputs on hand and Capacity, then age and spoil stock.
  const made = allowances(industry, (l) => headcount * l.yield);
  const inputStock = { ...industry.inputStock };
  industry.lines.forEach((line, i) => {
    for (const [id, per] of Object.entries(line.inputs)) inputStock[id] = (inputStock[id] ?? 0) - made[i]! * per;
  });
  const prepared = industry.lines.map((line, i) => {
    const { batches, spoiled } = age(line);
    const produced = made[i]!;
    batches[0] = produced;
    return { line, batches, spoiled, produced };
  });

  // Cohorts buy the Products they get best value from first; what is bought lowers the need left
  // for the rest, so Products substitute for each other.
  const valueFor = (line: ProductLine) =>
    cohorts.reduce((s, c) => s + c.population * (tastes[c.id]?.[line.productId] ?? 1), 0) / Math.max(1, line.price > 0 ? line.price : line.ask);
  const order = prepared.filter((p) => productDef(p.line.productId).household).sort((a, b) => valueFor(b.line) - valueFor(a.line));

  const remaining = new Map(cohorts.map((c) => [c.id, Math.floor(c.population * GRAIN_NEED_PER_HEAD)]));
  const foodBought: Record<string, number> = {};
  const results = new Map<string, ProductLine>();
  let householdRevenue = 0;

  for (const { line, batches, spoiled, produced } of order) {
    const def = productDef(line.productId);
    const supply = batches.reduce((s, n) => s + n, 0);
    const buyers: Buyer[] = cohorts.map((c) => ({
      id: c.id,
      money: tierBudget(def.tier, balance(ledger, `${c.id}:money`)),
      need: remaining.get(c.id) ?? 0,
      maxWtp: Math.max(1, Math.round(def.maxWtp * (tastes[c.id]?.[line.productId] ?? 1) * (1 + c.hunger / 100))),
    })).filter((b) => b.need > 0);
    const auction = clearAuction(buyers, supply, askFor(line, batches));

    // The Markup / Discount applies after the price is discovered; buyers never spend more than they hold.
    const price = applyMarkup(auction.price, markups[line.productId]);
    let sold = 0;
    for (const [cohortId, wanted] of Object.entries(auction.fills)) {
      const units = Math.min(wanted, Math.floor(balance(ledger, `${cohortId}:money`) / price));
      if (units <= 0) continue;
      const paid = units * price;
      apply({
        type: "sale",
        entries: [
          { account: `${cohortId}:equity`, debit: paid },
          { account: `${cohortId}:money`, credit: paid },
          { account: acct.money, debit: paid },
          { account: acct.equity, credit: paid },
        ],
      });
      sold += units;
      householdRevenue += paid;
      remaining.set(cohortId, (remaining.get(cohortId) ?? 0) - units);
      foodBought[cohortId] = (foodBought[cohortId] ?? 0) + units;
    }

    results.set(line.productId, {
      ...line,
      batches: take(batches, sold),
      ask: nextAsk(industry, line, sold, supply, auction.price),
      produced,
      sold,
      demand: auction.demand,
      spoiled,
      price: sold > 0 ? price : line.price,
    });
  }
  // Products for other Industries were sold earlier this Tick, and keep that result.
  for (const { line, batches, spoiled, produced } of prepared) {
    if (!results.has(line.productId)) results.set(line.productId, { ...line, batches, produced, spoiled });
  }

  const next: Industry = {
    ...industry,
    lines: industry.lines.map((l) => results.get(l.productId)!),
    inputStock,
    capacity: Math.max(industry.baseCapacity, Math.floor(industry.capacity * (1 - DEPRECIATION))),
    headcount,
    wagesPaid,
    revenue: industry.revenue + householdRevenue,
    costs: industry.costs + wagesPaid,
    brokeTicks: balance(ledger, acct.money) < industry.wage ? industry.brokeTicks + 1 : 0,
  };
  const adjusted = { ...next, targetHeadcount: adjustHeadcount(next) };
  if (adjusted.brokeTicks >= BROKE_AFTER) {
    const failure = fail(adjusted, ledger, tick);
    return { industry: failure.industry, ledger: failure.ledger, events: [...events, ...failure.events], fills: foodBought, incomeTax, householdSpending: householdRevenue };
  }
  return { industry: adjusted, ledger, events, fills: foodBought, incomeTax, householdSpending: householdRevenue };
}

/**
 * Sales feedback: sold out means the ask was too low, leftovers mean it was too high.
 * Unit cost is only a soft floor on the ask, not what sets it.
 */
export function nextAsk(industry: Industry, line: ProductLine, sold: number, supply: number, clearing: number): number {
  const softFloor = Math.max(1, Math.ceil(industry.wage / line.yield / 2));
  const soldOut = sold > 0 && sold === supply;
  return soldOut
    ? Math.max(line.ask, Math.ceil(clearing * 1.1))
    : Math.max(softFloor, Math.floor((sold > 0 ? clearing : line.ask) * 0.9));
}

/** Default Industry Policy: grow while demand goes unmet at a profit, shrink on a glut or a loss. */
function adjustHeadcount(industry: Industry): number {
  const { targetHeadcount: target, lines, headcount } = industry;
  if (target === 0) return 0;
  const step = Math.max(1, Math.floor(target * 0.1));
  const unmet = lines.some((l) => l.demand > l.sold);
  const made = lines.reduce((n, l) => n + l.produced, 0);
  const soldNow = lines.reduce((n, l) => n + l.sold, 0);
  const glut = made > 0 && soldNow * 2 < made && lines.reduce((n, l) => n + stockOf(l), 0) > 2 * made;
  const losing = headcount > 0 && industry.revenue < industry.costs && !unmet;
  if (glut || losing) return Math.max(1, target - step);
  const room = Math.floor(industry.capacity / Math.max(1, capacityPerWorker(lines)));
  if (unmet && industry.revenue >= industry.costs && headcount >= target && target + step <= room) return target + step;
  return target;
}

/** A failed Industry lays off its workers; its cash repays what it can of its Industry Loan and the rest is written off. */
function fail(industry: Industry, ledger: Ledger, tick: number): { industry: Industry; ledger: Ledger; events: MoneyEvent[] } {
  const acct = industryAccounts(industry);
  const events: MoneyEvent[] = [];
  const apply = (tx: Transaction) => {
    const result = post(ledger, tx, tick);
    ledger = result.ledger;
    if (result.event) events.push(result.event);
  };
  const owed = balance(ledger, acct.loanOwed);
  const repaid = Math.min(owed, balance(ledger, acct.money));
  if (repaid > 0) {
    apply({
      type: "industryRepayment",
      entries: [
        { account: acct.loanOwed, debit: repaid },
        { account: "treasury:loansReceivable", credit: repaid },
        { account: "treasury:money", debit: repaid },
        { account: acct.money, credit: repaid },
      ],
    });
  }
  const lost = owed - repaid;
  if (lost > 0) {
    apply({
      type: "writeOffLoss",
      entries: [
        { account: acct.loanOwed, debit: lost },
        { account: "treasury:loansReceivable", credit: lost },
      ],
    });
  }
  return {
    industry: {
      ...industry,
      started: false,
      failed: true,
      laidOff: industry.targetHeadcount,
      targetHeadcount: 0,
      headcount: 0,
      wagesPaid: 0,
      writtenOff: industry.writtenOff + lost,
      inputStock: {},
      lines: industry.lines.map((l) => ({ ...l, batches: [], plan: 0 })),
    },
    ledger,
    events,
  };
}
