import { describe, expect, it } from "vitest";
import { cohorts, createWorld, deserialize, productMarkets, serialize, step, type Command, type World } from "./index";
import { tierBudget } from "./products";

const LOAN: Command[] = [
  { type: "monetize", amount: 70_000 },
  { type: "industryLoan", industryId: "agriculture", amount: 1000 },
];

/** A started world where every cohort has plenty of money, so supply and prices drive what happens. */
function rich(grant = 20_000): World {
  // Budget limits on bids are covered by the call auction tests.
  const start = createWorld(42);
  const grants = cohorts(start).map((c): Command => ({ type: "grant", cohortId: c.id, amount: grant }));
  return step(start, [...LOAN, ...grants]).world;
}

function mapLines(world: World, productId: string, change: (line: World["industries"][number]["lines"][number]) => object): World {
  return {
    ...world,
    industries: world.industries.map((i) => ({
      ...i,
      lines: i.lines.map((l) => (l.productId === productId ? { ...l, ...change(l) } : l)),
    })),
  };
}
const withBatches = (world: World, productId: string, batches: number[]) => mapLines(world, productId, () => ({ batches }));

const market = (world: World, id: string) => productMarkets(world).find((m) => m.id === id)!;
const run = (world: World, ticks: number) => {
  for (let i = 0; i < ticks; i++) world = step(world, []).world;
  return world;
};

describe("food Products", () => {
  it("compete in the same Tick: grain, vegetables, meat and dairy all sell to hungry cohorts", () => {
    const world = rich();
    for (const id of ["grain", "vegetables", "meat", "dairy"]) expect(market(world, id).sold).toBeGreaterThan(0);
  });

  it("substitute: cohorts buy more vegetables when grain is out of reach", () => {
    const stocked = mapLines(withBatches(rich(), "vegetables", [5000]), "vegetables", () => ({ ask: 5 }));
    const grainUnaffordable = mapLines(stocked, "grain", () => ({ ask: 1000 }));
    const normal = market(step(stocked, []).world, "vegetables").sold;
    const substituted = market(step(grainUnaffordable, []).world, "vegetables").sold;
    expect(substituted).toBeGreaterThan(normal);
  });

  it("show supply and demand for inspection", () => {
    const grain = market(rich(), "grain");
    expect(grain).toMatchObject({ name: "Grain", tier: "essentials" });
    expect(grain.supply).toBeGreaterThan(0);
    expect(grain.demand).toBeGreaterThan(grain.supply);
    expect(grain.price).toBeGreaterThan(0);
  });
});

describe("Willingness to Pay", () => {
  it("rises with hunger: starving cohorts bid grain higher than fed ones", () => {
    const fed = rich();
    const hungry = { ...fed, cohorts: fed.cohorts.map((c) => ({ ...c, hunger: 90 })) };
    expect(market(step(hungry, []).world, "grain").price).toBeGreaterThan(market(step(fed, []).world, "grain").price);
  });

  it("drifts with taste, deterministically and within bounds", () => {
    const a = run(rich(), 10);
    expect(serialize(a)).toBe(serialize(run(rich(), 10)));
    const tastes = Object.values(a.tastes).flatMap((t) => Object.values(t));
    expect(tastes.some((t) => t !== 1)).toBe(true);
    expect(Math.min(...tastes)).toBeGreaterThanOrEqual(0.6);
    expect(Math.max(...tastes)).toBeLessThanOrEqual(1.4);
  });

  it("funds essentials from the whole budget and lower tiers from a share", () => {
    expect(tierBudget("essentials", 1000)).toBe(1000);
    expect(tierBudget("comforts", 1000)).toBeLessThan(1000);
    expect(tierBudget("education", 1000)).toBeLessThan(tierBudget("comforts", 1000));
  });
});

describe("shortages", () => {
  it("push the price up, and it falls back once supply recovers", () => {
    const shortage = run(rich(), 3);
    const peak = market(shortage, "grain").price;
    const recovered = run(withBatches(shortage, "grain", [100_000]), 15);
    expect(market(recovered, "grain").price).toBeLessThan(peak);
  });
});

describe("perishable food", () => {
  it("spoils once it outlives its shelf life, while grain keeps", () => {
    const world = withBatches(withBatches(rich(), "vegetables", [0, 0, 0, 0, 50]), "grain", [0, 0, 0, 0, 0, 0, 0, 0, 0, 50]);
    const next = step(world, []).world;
    expect(market(next, "vegetables").spoiled).toBe(50);
    expect(market(next, "grain").spoiled).toBe(0);
  });

  it("is marked down as it ages", () => {
    const fresh = step(withBatches(rich(), "vegetables", [5000]), []).world;
    const aged = step(withBatches(rich(), "vegetables", [0, 0, 5000]), []).world;
    expect(market(aged, "vegetables").price).toBeLessThan(market(fresh, "vegetables").price);
  });
});

describe("Markup / Discount", () => {
  it("defaults to 0% and adds a percentage to the discovered price", () => {
    const base = withBatches(rich(), "grain", [5000]);
    const plain = market(step(base, []).world, "grain");
    const marked = market(step(base, [{ type: "setMarkup", target: "grain", percent: 50 }]).world, "grain");
    expect(plain.markup).toBe(0);
    expect(marked.markup).toBe(50);
    expect(marked.price).toBe(Math.round(plain.price * 1.5));
  });

  it("applies a Discount to wages after the wage is discovered", () => {
    const wages = (w: World) => w.industries[0]!.wagesPaid;
    const plain = wages(step(rich(), []).world);
    const discounted = wages(step(rich(), [{ type: "setMarkup", target: "wages", percent: -50 }]).world);
    expect(discounted).toBe(plain / 2);
  });

  it("rejects an unknown target or a discount beyond 100%", () => {
    expect(() => step(rich(), [{ type: "setMarkup", target: "unobtainium", percent: 10 }])).toThrow(/Unknown/);
    expect(() => step(rich(), [{ type: "setMarkup", target: "grain", percent: -150 }])).toThrow(/Markup/);
  });

  it("survives a save", () => {
    const world = step(rich(), [{ type: "setMarkup", target: "grain", percent: 20 }]).world;
    expect(serialize(deserialize(serialize(world)))).toBe(serialize(world));
    expect(market(world, "grain").markup).toBe(20);
  });
});
