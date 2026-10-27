import { describe, expect, it } from "vitest";
import { createWorld, deserialize, industries, moneySupply, commercialBank, serialize, step, type Command, type World } from "./index";
import { PRODUCTS } from "./products";

const IDS = ["agriculture", "mining-energy", "manufacturing", "construction", "retail-logistics", "healthcare-education", "research-labs"];

const fund = (ids: string[], each = 20_000): Command[] => [
  { type: "monetize", amount: each * ids.length },
  ...ids.map((industryId): Command => ({ type: "industryLoan", industryId, amount: each })),
];
const run = (world: World, ticks: number) => {
  for (let i = 0; i < ticks; i++) world = step(world, []).world;
  return world;
};
const view = (world: World, id: string) => industries(world).find((i) => i.id === id)!;
const withIndustry = (world: World, id: string, change: (i: World["industries"][number]) => object): World => ({
  ...world,
  industries: world.industries.map((i) => (i.id === id ? { ...i, ...change(i) } : i)),
});

describe("the seven starting Industries", () => {
  it("all exist and can each be started by an Industry Loan", () => {
    expect(industries(createWorld(1)).map((i) => i.id)).toEqual(IDS);
    for (const id of IDS) {
      const world = step(createWorld(1), fund([id], 1000)).world;
      expect(view(world, id).started).toBe(true);
    }
  });

  it("make about fifteen Products with shelf lives, defined in data", () => {
    expect(PRODUCTS.length).toBeGreaterThanOrEqual(14);
    expect(PRODUCTS.length).toBeLessThanOrEqual(16);
    const made = industries(createWorld(1)).flatMap((i) => i.lines.map((l) => l.productId));
    expect(new Set(made).size).toBe(PRODUCTS.length);
    for (const i of industries(createWorld(1))) {
      for (const line of i.lines) {
        expect(line.capacityPerUnit).toBeGreaterThan(0);
        for (const input of Object.keys(line.inputs)) expect(PRODUCTS.some((p) => p.id === input)).toBe(true);
      }
    }
  });

  it("form a web: running all seven for a while, every Industry produces and none fails", () => {
    let world = step(createWorld(42), fund(IDS)).world;
    const produced = new Set<string>();
    for (let t = 0; t < 120; t++) {
      world = step(world, []).world;
      for (const i of industries(world)) if (i.lines.some((l) => l.produced > 0)) produced.add(i.id);
    }
    expect([...produced].sort()).toEqual([...IDS].sort());
    expect(industries(world).filter((i) => i.failed)).toEqual([]);
    expect(moneySupply(world) - commercialBank(world).deposits).toBe(20_000 * 7);
  });
});

describe("Capacity", () => {
  it("depreciates when nothing replaces it", () => {
    const world = step(createWorld(42), fund(["agriculture"], 5000)).world;
    const before = view(world, "agriculture").capacity;
    expect(before).toBeGreaterThan(0);
    expect(view(run(world, 10), "agriculture").capacity).toBeLessThan(before);
  });

  it("is bought as capital goods from the Industry that makes them", () => {
    let world = step(createWorld(42), fund(["agriculture", "manufacturing"], 5000)).world;
    world = withIndustry(world, "agriculture", () => ({ capacity: 10 }));
    world = withIndustry(world, "manufacturing", (i) => ({
      lines: i.lines.map((l) => (l.productId === "tools" ? { ...l, batches: [50] } : l)),
    }));
    const next = step(world, []).world;
    expect(view(next, "agriculture").capacity).toBeGreaterThan(10);
    const tools = view(next, "manufacturing").lines.find((l) => l.productId === "tools")!;
    expect(tools.sold).toBeGreaterThan(0);
  });
});

describe("failure", () => {
  it("writes off the debts of an Industry that cannot pay and lays its workers off", () => {
    const start = step(createWorld(42), fund(["mining-energy"], 100)).world;
    // Buyers who vanish: the ore it planned for finds no market.
    let world = withIndustry(start, "mining-energy", (i) => ({
      lines: i.lines.map((l) => (l.productId === "ore" ? { ...l, expected: 1000 } : l)),
    }));
    world = run(world, 12);
    const mining = view(world, "mining-energy");
    expect(mining).toMatchObject({ failed: true, started: false, headcount: 0, targetHeadcount: 0, loanOwed: 0 });
    expect(mining.laidOff).toBeGreaterThan(0);
    expect(mining.writtenOff).toBeGreaterThan(0);
    expect(moneySupply(world) - commercialBank(world).deposits).toBe(100);
  });

  it("can be restarted with a fresh Industry Loan", () => {
    const failed = run(step(createWorld(42), fund(["manufacturing"], 5)).world, 8);
    expect(view(failed, "manufacturing").failed).toBe(true);
    const again = step(failed, fund(["manufacturing"], 500)).world;
    expect(view(again, "manufacturing")).toMatchObject({ started: true, failed: false });
  });
});

describe("the input-output web", () => {
  it("lets a Manufacturing slump slow the growth of other Industries", () => {
    const others = IDS.filter((i) => i !== "manufacturing");
    const track = (ids: string[]) => {
      let world = step(createWorld(42), fund(ids)).world;
      let agriculture = 0;
      let rest = 0;
      for (let t = 0; t < 100; t++) {
        world = step(world, []).world;
        agriculture += view(world, "agriculture").headcount;
        rest += industries(world).filter((i) => i.id !== "agriculture").reduce((s, i) => s + i.headcount, 0);
      }
      return { world, agriculture, rest };
    };
    const healthy = track(IDS);
    const slump = track(others);
    // Without tools and machinery, Capacity wears away, so Agriculture and the rest hire less.
    expect(view(slump.world, "agriculture").capacity).toBeLessThan(view(healthy.world, "agriculture").capacity);
    expect(slump.agriculture).toBeLessThan(healthy.agriculture);
    expect(slump.rest).toBeLessThan(healthy.rest);
  });

  it("is deterministic and survives a save", () => {
    const world = run(step(createWorld(7), fund(IDS)).world, 30);
    expect(serialize(run(deserialize(serialize(world)), 5))).toBe(serialize(run(world, 5)));
  });
});
