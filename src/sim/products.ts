import { seededRandom } from "./rng";
import productData from "./data/products.json";

/** Budget tiers, in the order a Household Cohort funds them: essentials first, education last. */
export type Tier = "essentials" | "comforts" | "durables" | "education";

/** Share of a cohort's money that is available to each tier. Lower tiers only get what is left over. */
const TIER_SHARE: Record<Tier, number> = { essentials: 1, comforts: 0.5, durables: 0.3, education: 0.2 };

export function tierBudget(tier: Tier, money: number): number {
  return Math.floor(money * TIER_SHARE[tier]);
}

export interface ProductDef {
  id: string;
  name: string;
  tier: Tier;
  /** Willingness to Pay for the most urgent unit, at neutral taste and no hunger. */
  maxWtp: number;
  /** Ticks after which unsold stock is thrown away, or null for goods that keep. */
  shelfLife: number | null;
  /** True for Products sold to Household Cohorts; the rest are sold to other Industries. */
  household?: boolean;
  /** Capacity one unit adds when an Industry buys it as a capital good. */
  capacityPerGood?: number;
}

/** Products are defined in `data/products.json`. */
export const PRODUCTS = productData as ProductDef[];

export function productDef(id: string): ProductDef {
  const def = PRODUCTS.find((p) => p.id === id);
  if (!def) throw new Error(`Unknown Product ${id}`);
  return def;
}

/** Each cohort's taste for each Product, a multiplier on Willingness to Pay. */
export type Tastes = Record<string, Record<string, number>>;

export const MIN_TASTE = 0.6;
export const MAX_TASTE = 1.4;
const TASTE_DRIFT = 0.1;

export function neutralTastes(cohortIds: string[]): Tastes {
  return Object.fromEntries(cohortIds.map((id) => [id, Object.fromEntries(PRODUCTS.filter((p) => p.household).map((p) => [p.id, 1]))]));
}

/** Tastes wander a little each Tick, deterministically from the seed and Tick. */
export function driftTastes(tastes: Tastes, seed: number, tick: number): Tastes {
  const random = seededRandom((seed * 7919 + tick * 104729) >>> 0);
  return Object.fromEntries(
    Object.entries(tastes).map(([cohortId, byProduct]) => [
      cohortId,
      Object.fromEntries(
        Object.entries(byProduct).map(([productId, taste]) => [
          productId,
          Math.min(MAX_TASTE, Math.max(MIN_TASTE, taste + (random() - 0.5) * 2 * TASTE_DRIFT)),
        ]),
      ),
    ]),
  );
}

/** Applies a player Markup / Discount (percent, default 0) to a discovered price or wage. */
export function applyMarkup(value: number, percent: number | undefined): number {
  return Math.max(1, Math.round(value * (1 + (percent ?? 0) / 100)));
}
