import { post, type Ledger, type MoneyEvent, type Transaction } from "./ledger";
import { GRAIN_NEED_PER_HEAD } from "./households";
import { clearAuction, type Buyer } from "./market";

export interface Industry {
  id: string;
  name: string;
  /** Becomes true on the first Industry Loan; nothing happens before. */
  started: boolean;
  /** Grain held in stock, in units. Stock is physical and not carried on the ledger. */
  stock: number;
  /** The price the Industry asks, learned from whether yesterday's stock sold out. */
  ask: number;
  wage: number;
  targetHeadcount: number;
  unitsPerWorker: number;
  // Results of the latest Tick, for display.
  headcount: number;
  wagesPaid: number;
  produced: number;
  sold: number;
  price: number;
}

export interface IndustryView extends Industry {
  money: number;
  loanOwed: number;
  equity: number;
}

export const WORKER_COHORT = "cohort-0";
/** Willingness to Pay for the most urgent unit of grain. */
const GRAIN_MAX_WTP = 20;

export function newAgriculture(): Industry {
  return {
    id: "agriculture",
    name: "Agriculture",
    started: false,
    stock: 0,
    ask: 10,
    wage: 10,
    targetHeadcount: 10,
    unitsPerWorker: 2,
    headcount: 0,
    wagesPaid: 0,
    produced: 0,
    sold: 0,
    price: 0,
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

/** One Tick of an Industry: hire and pay wages, produce, then sell its stock at the call auction. */
export function runIndustry(
  industry: Industry,
  ledger: Ledger,
  cohorts: { id: string; population: number }[],
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

  const headcount = Math.min(industry.targetHeadcount, Math.floor(balance(ledger, acct.money) / industry.wage));
  const wagesPaid = headcount * industry.wage;
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

  const produced = headcount * industry.unitsPerWorker;
  const supply = industry.stock + produced;

  const buyers: Buyer[] = cohorts.map((c) => ({
    id: c.id,
    money: balance(ledger, `${c.id}:money`),
    need: Math.floor(c.population * GRAIN_NEED_PER_HEAD),
    maxWtp: GRAIN_MAX_WTP,
  }));
  const auction = clearAuction(buyers, supply, industry.ask);

  for (const [cohortId, units] of Object.entries(auction.fills)) {
    const paid = units * auction.price;
    apply({
      type: "sale",
      entries: [
        { account: `${cohortId}:equity`, debit: paid },
        { account: `${cohortId}:money`, credit: paid },
        { account: acct.money, debit: paid },
        { account: acct.equity, credit: paid },
      ],
    });
  }

  // Sales feedback: sold out means the ask was too low, leftovers mean it was too high.
  // Unit cost is only a soft floor on the ask, not what sets it.
  const unitCost = industry.wage / industry.unitsPerWorker;
  const softFloor = Math.max(1, Math.ceil(unitCost / 2));
  const soldOut = auction.quantity > 0 && auction.quantity === supply;
  const ask = soldOut
    ? Math.max(industry.ask, Math.ceil(auction.price * 1.1))
    : Math.max(softFloor, Math.floor((auction.quantity > 0 ? auction.price : industry.ask) * 0.9));

  return {
    industry: {
      ...industry,
      stock: supply - auction.quantity,
      ask,
      headcount,
      wagesPaid,
      produced,
      sold: auction.quantity,
      price: auction.quantity > 0 ? auction.price : industry.price,
    },
    ledger,
    events,
    fills: auction.fills,
  };
}
