import { describe, expect, it } from "vitest";
import { cohortViews, createWorld, gdp, history, step, type Command, type World } from "./index";

const IDS = ["agriculture", "mining-energy", "manufacturing", "construction", "retail-logistics", "healthcare-education", "research-labs"];
const fund: Command[] = [
  { type: "monetize", amount: 400_000 },
  ...IDS.map((industryId): Command => ({ type: "industryLoan", industryId, amount: 20_000 })),
  { type: "setPublicFunding", service: "healthcare", percent: 50 },
  { type: "setPublicFunding", service: "education", percent: 50 },
];

/** Final sales of the latest Tick read straight off the ledger's flows, as an independent check on `gdp`. */
function finalSalesOnLedger(world: World): number {
  const households = new Set(cohortViews(world).map((c) => c.name));
  return (world.ledger.flows ?? [])
    .filter((f) => f.tick === world.tick - 1)
    .filter((f) => (f.cause === "Sale" && households.has(f.from)) || f.cause === "Durable purchase" || f.cause === "Public Funding")
    .reduce((s, f) => s + f.amount, 0);
}

describe("GDP", () => {
  it("is zero before anything is sold", () => {
    expect(gdp(createWorld(1))).toBe(0);
    expect(gdp(step(createWorld(1), []).world)).toBe(0);
  });

  it("is the value of final sales in the latest Tick: Households' purchases, the Government's and house and car purchases, but not Industries selling to each other", () => {
    let world = step(createWorld(42, { housed: 0.5 }), fund).world;
    let sawPublic = false;
    for (let t = 0; t < 40; t++) {
      world = step(world, t === 0 ? [{ type: "grant", cohortId: "cohort-0", amount: 5000 }] : []).world;
      expect(gdp(world)).toBe(finalSalesOnLedger(world));
      expect(history(world).at(-1)!.gdp).toBe(gdp(world));
      if (world.education.publicSpending + world.education.healthcareFunding > 0) sawPublic = true;
    }
    expect(gdp(world)).toBeGreaterThan(0);
    expect(sawPublic).toBe(true);
    // Industries do sell to each other, and that is left out.
    const households = new Set(cohortViews(world).map((c) => c.name));
    const sales = (world.ledger.flows ?? []).filter((f) => f.tick === world.tick - 1 && f.cause === "Sale");
    expect(sales.some((f) => !households.has(f.from))).toBe(true);
  });

  it("counts a house purchase", () => {
    const start = step(createWorld(42, { housed: 0.5 }), [...fund, { type: "grant", cohortId: "cohort-0", amount: 5000 }]).world;
    const stocked: World = {
      ...start,
      industries: start.industries.map((i) =>
        i.id === "construction" ? { ...i, lines: i.lines.map((l) => ({ ...l, batches: [400] })) } : i,
      ),
    };
    const next = step(stocked, []).world;
    expect(gdp(next)).toBe(finalSalesOnLedger(next));
    expect((next.ledger.flows ?? []).some((f) => f.tick === next.tick - 1 && f.cause === "Durable purchase")).toBe(true);
    expect(gdp(next)).toBeGreaterThanOrEqual(800);
  });

  it("survives a save made before it existed", () => {
    const world = step(createWorld(1), fund).world;
    const legacy = { ...world, flows: { ...world.flows, durableSpending: undefined } } as unknown as World;
    expect(Number.isFinite(gdp(legacy))).toBe(true);
  });
});
