import type { Industry } from "./industry";
import type { ProductMarketView } from "./index";

export interface Explanation {
  /** The Tick whose events this explains. */
  tick: number;
  kind: "industryFailure" | "priceRise";
  text: string;
}

/** A price must rise by at least this share in one Tick to be worth explaining. */
export const PRICE_RISE_THRESHOLD = 0.1;

const whole = (n: number) => Math.round(n).toLocaleString("en-US");

/** Readable reasons for what changed over one Tick, in terms the player can act on. */
export function explainTick(
  tick: number,
  before: { industries: Industry[]; products: ProductMarketView[] },
  after: { industries: Industry[]; products: ProductMarketView[] },
): Explanation[] {
  const notes: Explanation[] = [];
  for (const industry of after.industries) {
    const was = before.industries.find((i) => i.id === industry.id);
    if (!was || was.failed || !industry.failed) continue;
    const lost = industry.writtenOff - was.writtenOff;
    notes.push({
      tick,
      kind: "industryFailure",
      text:
        `${industry.name} failed: it could not afford any workers for several Ticks in a row, so it laid off ${whole(industry.laidOff)} jobs. ` +
        (lost > 0
          ? `Its cash did not cover its Industry Loan, so ${whole(lost)} was written off. A new Industry Loan would restart it.`
          : `Its cash repaid its Industry Loan in full. A new Industry Loan would restart it.`),
    });
  }
  for (const product of after.products) {
    const was = before.products.find((p) => p.id === product.id);
    if (!was || was.price <= 0 || product.price < was.price * (1 + PRICE_RISE_THRESHOLD)) continue;
    const percent = Math.round((product.price / was.price - 1) * 100);
    notes.push({
      tick,
      kind: "priceRise",
      text:
        `${product.name} price rose ${percent}% (from ${was.price.toFixed(2)} to ${product.price.toFixed(2)}): ` +
        (product.demand > product.supply
          ? `buyers wanted ${whole(product.demand)} units but only ${whole(product.supply)} were for sale.`
          : `buyers wanted ${whole(product.demand)} units against ${whole(product.supply)} for sale, so sellers who sold out asked more.`),
    });
  }
  return notes;
}
