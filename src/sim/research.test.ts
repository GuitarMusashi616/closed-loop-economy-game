import { describe, expect, it } from "vitest";
import { createWorld, deserialize, industries, productMarkets, research, serialize, step, type Command, type World } from "./index";

const IDS = ["agriculture", "mining-energy", "manufacturing", "construction", "retail-logistics", "healthcare-education", "research-labs"];

/** A running economy with a funded Treasury, so Research Labs can be paid. */
function economy(seed = 7, treasuryFloat = 200_000): World {
  const commands: Command[] = [
    { type: "monetize", amount: 20_000 * IDS.length + treasuryFloat },
    ...IDS.map((industryId): Command => ({ type: "industryLoan", industryId, amount: 20_000 })),
  ];
  return step(createWorld(seed), commands).world;
}
const run = (world: World, ticks: number, commands: Command[] = []) => {
  world = step(world, commands).world;
  for (let i = 1; i < ticks; i++) world = step(world, []).world;
  return world;
};
const technologies = (world: World) => research(world).technologies;
const tech = (world: World, id: string) => technologies(world).find((t) => t.id === id)!;
const lab = (world: World) => industries(world).find((i) => i.id === "research-labs")!;
const withIndustry = (world: World, id: string, change: object): World => ({
  ...world,
  industries: world.industries.map((i) => (i.id === id ? { ...i, ...change } : i)),
});
const treasury = (world: World) => world.ledger.balances["treasury:money"] ?? 0;
const choose = (...technologyIds: string[]): Command => ({ type: "setResearch", technologyIds });
/** Steps until the Technology is researched (or gives up), returning the world. */
function until(world: World, id: string, limit = 150): World {
  for (let t = 0; t < limit && tech(world, id).status !== "researched"; t++) world = step(world, []).world;
  return world;
}

describe("the tech tree", () => {
  const tree = technologies(createWorld(1));

  it("has about twenty Technologies in four branches, each with a point cost", () => {
    expect(tree.length).toBeGreaterThanOrEqual(18);
    expect(tree.length).toBeLessThanOrEqual(22);
    expect(new Set(tree.map((t) => t.branch))).toEqual(new Set(["food", "materials-energy", "industry", "society"]));
    for (const t of tree) expect(t.cost).toBeGreaterThan(0);
  });

  it("has prerequisites that exist and never loop", () => {
    const ids = new Set(tree.map((t) => t.id));
    const visit = (id: string, path: string[]) => {
      expect(path).not.toContain(id);
      for (const r of tree.find((t) => t.id === id)!.requires) {
        expect(ids.has(r)).toBe(true);
        visit(r, [...path, id]);
      }
    };
    for (const t of tree) visit(t.id, []);
    expect(tree.some((t) => t.requires.length > 0)).toBe(true);
    expect(tree.some((t) => t.requires.length === 0)).toBe(true);
  });

  it("starts with one active slot and nothing researched", () => {
    const view = research(createWorld(1));
    expect(view.slots).toBe(1);
    expect(view.active).toEqual([]);
    expect(tree.every((t) => t.status !== "researched" && t.progress === 0)).toBe(true);
  });
});

describe("choosing the active Technology", () => {
  it("accepts an available Technology and rejects unknown, locked and over-slot choices", () => {
    const world = createWorld(1);
    const locked = technologies(world).find((t) => t.requires.length > 0)!;
    expect(locked.status).toBe("locked");
    expect(() => step(world, [choose("nope")])).toThrow(/Unknown Technology/);
    expect(() => step(world, [choose(locked.id)])).toThrow(/prerequisite/);
    const [a, b] = technologies(world).filter((t) => t.status === "available");
    expect(() => step(world, [choose(a!.id, b!.id)])).toThrow(/slot/);
    expect(research(step(world, [choose(a!.id)]).world).active).toEqual([a!.id]);
  });
});

describe("Research", () => {
  it("makes no progress when no Technology is active", () => {
    const world = run(economy(), 12);
    expect(technologies(world).every((t) => t.progress === 0)).toBe(true);
    expect(research(world).pointsLastTick).toBe(0);
  });

  it("is paid for by Government contracts: the Treasury pays the Labs per point delivered", () => {
    const world = run(economy(), 8, [choose("workshops")]);
    const before = { treasury: treasury(world), progress: tech(world, "workshops").progress };
    expect(tech(world, "workshops").status).toBe("active");
    const next = step(world, []).world;
    const points = research(next).pointsLastTick;
    expect(points).toBeGreaterThan(0);
    expect(tech(next, "workshops").progress).toBeCloseTo(before.progress + points, 6);
    const paid = before.treasury - treasury(next);
    expect(paid).toBeGreaterThan(0);
    expect(paid % points).toBe(0);
    expect(paid / points).toBe(research(next).contractPrice);
    // The Labs earned it: their revenue this Tick includes the contract.
    expect(lab(next).revenue).toBeGreaterThanOrEqual(paid);
  });

  it("pays scientists wages while researching", () => {
    const world = run(economy(), 14, [choose("orchards")]);
    expect(lab(world).wagesPaid).toBeGreaterThan(0);
    expect(lab(world).headcount).toBeGreaterThan(0);
  });

  it("stops when the Treasury cannot pay", () => {
    const world = run(economy(7, 0), 14, [choose("orchards")]);
    expect(tech(world, "orchards").progress).toBe(0);
  });

  it("goes faster with more scientists", () => {
    const small = run(withIndustry(economy(), "research-labs", { targetHeadcount: 4 }), 14, [choose("orchards")]);
    const large = run(economy(), 14, [choose("orchards")]);
    expect(tech(small, "orchards").progress).toBeGreaterThan(0);
    expect(tech(large, "orchards").progress).toBeGreaterThan(1.5 * tech(small, "orchards").progress);
  });

  it("goes faster with more productive (experienced) scientists", () => {
    const novice = withIndustry(economy(), "research-labs", { targetHeadcount: 4 });
    const expert = { ...novice, labor: { skills: { "research-labs": 1 } } };
    // Points delivered over a few Ticks once the Labs are staffed.
    const pace = (world: World) => {
      world = run(world, 14, [choose("workshops")]);
      let points = 0;
      for (let t = 0; t < 4; t++) {
        world = step(world, []).world;
        points += research(world).pointsLastTick;
      }
      expect(tech(world, "workshops").status).toBe("active");
      return { points, productivity: lab(world).productivity };
    };
    const slow = pace(novice);
    const fast = pace(expert);
    expect(fast.productivity).toBeGreaterThan(slow.productivity);
    expect(slow.points).toBeGreaterThan(0);
    expect(fast.points).toBeGreaterThan(1.3 * slow.points);
  });

  it("completes a Technology once its cost is reached, then unlocks what depends on it", () => {
    let world = run(economy(), 2, [choose("orchards")]);
    expect(tech(world, "orchards").status).toBe("active");
    expect(tech(world, "fisheries").status).toBe("locked");
    world = until(world, "orchards");
    expect(tech(world, "orchards").status).toBe("researched");
    expect(research(world).active).toEqual([]);
    expect(tech(world, "fisheries").status).toBe("available");
  });

  it("unlocks new food Products: Orchards makes Fruit available and Agriculture grows it", () => {
    let world = economy();
    const fruitLine = (w: World) => industries(w).find((i) => i.id === "agriculture")!.lines.some((l) => l.productId === "fruit");
    expect(productMarkets(world).some((p) => p.id === "fruit")).toBe(false);
    expect(fruitLine(world)).toBe(false);
    world = until(run(world, 1, [choose("orchards")]), "orchards");
    expect(fruitLine(world)).toBe(true);
    expect(productMarkets(world).some((p) => p.id === "fruit")).toBe(true);
    let made = 0;
    let sold = 0;
    for (let t = 0; t < 30; t++) {
      world = step(world, []).world;
      const fruit = productMarkets(world).find((p) => p.id === "fruit")!;
      made += fruit.produced;
      sold += fruit.sold;
    }
    expect(made).toBeGreaterThan(0);
    expect(sold).toBeGreaterThan(0);
  });

  it("unlocks more slots through a Technology, so two can be researched at once", () => {
    let world = economy();
    expect(() => step(world, [choose("orchards", "public-administration")])).toThrow(/slot/);
    world = until(run(world, 1, [choose("public-administration")]), "public-administration");
    expect(research(world).slots).toBe(2);
    world = step(world, [choose("orchards", "prospecting")]).world;
    expect(research(world).active).toEqual(["orchards", "prospecting"]);
    world = run(world, 10);
    expect(tech(world, "orchards").progress).toBeGreaterThan(0);
    expect(tech(world, "prospecting").progress).toBeGreaterThan(0);
  });

  it("round-trips through a save", () => {
    const world = run(economy(), 6, [choose("orchards")]);
    const loaded = deserialize(serialize(world));
    expect(research(loaded)).toEqual(research(world));
    expect(research(step(loaded, []).world)).toEqual(research(step(world, []).world));
  });
});
