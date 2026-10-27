/** A Household Cohort's side of one Product's market for a Tick. */
export interface Buyer {
  id: string;
  /** Money available to spend this Tick. */
  money: number;
  /** Units the cohort would like to buy today, with urgency falling as they are met. */
  need: number;
  /** Willingness to Pay for the most urgent unit. */
  maxWtp: number;
}

export interface AuctionResult {
  price: number;
  quantity: number;
  /** Units buyers wanted at the clearing price, whether or not there was stock for them. */
  demand: number;
  fills: Record<string, number>;
}

/** Willingness to Pay for the unit at `index`, falling linearly from `maxWtp` to 1 across the need. */
function wtp(buyer: Buyer, index: number): number {
  return Math.max(1, Math.ceil((buyer.maxWtp * (buyer.need - index)) / buyer.need));
}

/** Units a buyer wants at `price`, limited by what their money can pay for. */
function wanted(buyer: Buyer, price: number): number {
  let units = 0;
  while (units < buyer.need && wtp(buyer, units) >= price) units++;
  return Math.min(units, Math.floor(buyer.money / price));
}

function demandAt(buyers: Buyer[], price: number): number {
  return buyers.reduce((sum, b) => sum + wanted(b, price), 0);
}

/**
 * Uniform-price call auction for one seller offering `supply` units at no less than `ask`.
 * If demand at the ask covers less than the supply, the ask is the price. Otherwise bidding
 * lifts the price to the highest level at which demand still takes all the supply.
 */
export function clearAuction(buyers: Buyer[], supply: number, ask: number): AuctionResult {
  const floor = Math.max(1, Math.ceil(ask));
  const none: AuctionResult = { price: floor, quantity: 0, demand: 0, fills: {} };
  if (supply <= 0 || demandAt(buyers, floor) === 0) return { ...none, demand: demandAt(buyers, floor) };

  let price = floor;
  if (demandAt(buyers, floor) > supply) {
    const ceiling = Math.max(...buyers.map((b) => b.maxWtp));
    while (price < ceiling && demandAt(buyers, price + 1) >= supply) price++;
  }

  const wants = buyers.map((b) => ({ id: b.id, units: wanted(b, price) }));
  const total = wants.reduce((s, w) => s + w.units, 0);
  const quantity = Math.min(supply, total);
  const fills: Record<string, number> = {};
  let allocated = 0;
  for (const w of wants) {
    fills[w.id] = Math.floor((w.units * quantity) / total);
    allocated += fills[w.id]!;
  }
  // Hand out the units lost to rounding one at a time, in cohort order.
  for (const w of wants) {
    if (allocated >= quantity) break;
    if (fills[w.id]! < w.units) {
      fills[w.id]!++;
      allocated++;
    }
  }
  for (const id of Object.keys(fills)) if (fills[id] === 0) delete fills[id];
  return { price, quantity, demand: demandAt(buyers, floor), fills };
}
