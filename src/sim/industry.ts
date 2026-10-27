import { post, type Ledger, type MoneyEvent, type Transaction } from "./ledger";
import { GRAIN_NEED_PER_HEAD } from "./households";
import { clearAuction, type Buyer } from "./market";
import { applyMarkup, productDef, tierBudget, type Tastes } from "./products";

/** One Product an Industry sells, with its stock, asking price and the results of the latest Tick. */
export interface ProductLine {
  productId: string;
  /** Units each worker makes of this Product per Tick. */
  yield: number;
  /** Stock by age in Ticks: `batches[0]` was made this Tick. Stock is physical and not on the ledger. */
  batches: number[];
  /** The price the Industry asks, learned from whether yesterday's stock sold out. */
  ask: number;
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
  // Results of the latest Tick, for display.
  headcount: number;
  wagesPaid: number;
}

export interface IndustryView extends Industry {
  money: number;
  loanOwed: number;
  equity: number;
}

export const WORKER_COHORT = "cohort-0";

export const stockOf = (line: ProductLine) => line.batches.reduce((s, n) => s + n, 0);

function newLine(productId: string, yieldPerWorker: number, ask: number): ProductLine {
  return { productId, yield: yieldPerWorker, batches: [], ask, produced: 0, sold: 0, demand: 0, spoiled: 0, price: 0 };
}

export function newAgriculture(): Industry {
  return {
    id: "agriculture",
    name: "Agriculture",
    started: false,
    lines: [newLine("grain", 2, 10), newLine("vegetables", 1, 10), newLine("meat", 1, 14), newLine("dairy", 1, 12)],
    wage: 10,
    targetHeadcount: 10,
    headcount: 0,
    wagesPaid: 0,
  };
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
function askFor(line: ProductLine, batches: number[]): number {
  const shelfLife = productDef(line.productId).shelfLife;
  const oldest = batches.reduce((o, n, i) => (n > 0 ? i : o), 0);
  if (shelfLife === null) return line.ask;
  return Math.max(1, Math.floor(line.ask * (1 - (0.5 * oldest) / shelfLife)));
}

/** Removes `units` from stock, oldest first. */
function take(batches: number[], units: number): number[] {
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
}

/** One Tick of an Industry: hire and pay wages, produce, then sell each Product at its call auction. */
export function runIndustry(
  industry: Industry,
  ledger: Ledger,
  inputs: MarketInputs,
  tick: number,
): { industry: Industry; ledger: Ledger; events: MoneyEvent[]; fills: Record<string, number> } {
  if (!industry.started) return { industry, ledger, events: [], fills: {} };
  const acct = industryAccounts(industry);
  const events: MoneyEvent[] = [];
  const apply = (tx: Transaction) => {
    const result = post(ledger, tx, tick);
    ledger = result.ledger;
    if (result.event) events.push(result.event);
  };
  const { cohorts, tastes, markups } = inputs;

  // The wage is discovered first, then the player's Markup / Discount applies on top.
  const wage = applyMarkup(industry.wage, markups.wages);
  const headcount = Math.min(industry.targetHeadcount, Math.floor(balance(ledger, acct.money) / wage));
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
  }

  // Age and spoil stock, then add today's production.
  const prepared = industry.lines.map((line) => {
    const { batches, spoiled } = age(line);
    const produced = headcount * line.yield;
    batches[0] = produced;
    return { line, batches, spoiled, produced };
  });

  // Cohorts buy the Products they get best value from first; what is bought lowers the need left
  // for the rest, so Products substitute for each other.
  const valueFor = (line: ProductLine) =>
    cohorts.reduce((s, c) => s + c.population * (tastes[c.id]?.[line.productId] ?? 1), 0) / Math.max(1, line.price > 0 ? line.price : line.ask);
  const order = [...prepared].sort((a, b) => valueFor(b.line) - valueFor(a.line));

  const remaining = new Map(cohorts.map((c) => [c.id, Math.floor(c.population * GRAIN_NEED_PER_HEAD)]));
  const foodBought: Record<string, number> = {};
  const results = new Map<string, ProductLine>();

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
      remaining.set(cohortId, (remaining.get(cohortId) ?? 0) - units);
      foodBought[cohortId] = (foodBought[cohortId] ?? 0) + units;
    }

    // Sales feedback: sold out means the ask was too low, leftovers mean it was too high.
    // Unit cost is only a soft floor on the ask, not what sets it.
    const softFloor = Math.max(1, Math.ceil(industry.wage / line.yield / 2));
    const soldOut = sold > 0 && sold === supply;
    const ask = soldOut
      ? Math.max(line.ask, Math.ceil(auction.price * 1.1))
      : Math.max(softFloor, Math.floor((sold > 0 ? auction.price : line.ask) * 0.9));

    results.set(line.productId, {
      ...line,
      batches: take(batches, sold),
      ask,
      produced,
      sold,
      demand: auction.demand,
      spoiled,
      price: sold > 0 ? price : line.price,
    });
  }

  return {
    industry: {
      ...industry,
      lines: industry.lines.map((l) => results.get(l.productId)!),
      headcount,
      wagesPaid,
    },
    ledger,
    events,
    fills: foodBought,
  };
}
