import { describe, expect, it } from "vitest";
import { cohorts, countrySummary, createWorld, explanations, history, industries, moneyFlows, moneyLog, moneySupply, productMarkets, step, type Command, type World } from "./index";

const IDS = ["agriculture", "mining-energy", "manufacturing", "construction", "retail-logistics", "healthcare-education", "research-labs"];
const fund = (ids: string[], each = 20_000): Command[] => [
  { type: "monetize", amount: each * ids.length },
  ...ids.map((industryId): Command => ({ type: "industryLoan", industryId, amount: each })),
];
const run = (world: World, ticks: number) => {
  for (let i = 0; i < ticks; i++) world = step(world, []).world;
  return world;
};
const link = (world: World, from: string, to: string) =>
  moneyFlows(world, 0, world.tick).links.find((l) => l.from === from && l.to === to)?.amount ?? 0;

describe("money flows between sectors", () => {
  it("show Monetization as creation into Government and a Grant as Government paying Households", () => {
    const start = createWorld(42);
    const { world } = step(start, [
      { type: "monetize", amount: 1000 },
      { type: "grant", cohortId: cohorts(start)[0]!.id, amount: 400 },
    ]);
    const flows = moneyFlows(world, 0, 0);
    expect(flows.links).toEqual(
      expect.arrayContaining([
        { from: "Money creation", to: "Government", amount: 1000 },
        { from: "Government", to: "Households", amount: 400 },
      ]),
    );
    expect(flows.created).toBe(1000);
    expect(flows.destroyed).toBe(0);
  });

  it("cover only the chosen period", () => {
    let world = step(createWorld(42), [{ type: "monetize", amount: 1000 }]).world;
    world = step(world, [{ type: "monetize", amount: 250 }]).world;
    expect(moneyFlows(world, 0, 0).created).toBe(1000);
    expect(moneyFlows(world, 1, 1).created).toBe(250);
    expect(moneyFlows(world, 0, 1).created).toBe(1250);
    expect(moneyFlows(world, 5, 9).links).toEqual([]);
  });

  it("send wages from Industries to Households and spending back, and reconcile with the money log", () => {
    const world = run(step(createWorld(42), fund(IDS)).world, 60);
    expect(link(world, "Industries", "Households")).toBeGreaterThan(0);
    expect(link(world, "Households", "Industries")).toBeGreaterThan(0);
    const flows = moneyFlows(world, 0, world.tick);
    const logged = (d: string) => moneyLog(world).filter((e) => e.direction === d).reduce((s, e) => s + e.amount, 0);
    expect(flows.created).toBe(logged("created"));
    expect(flows.destroyed).toBe(logged("destroyed"));
    expect(flows.created - flows.destroyed).toBe(moneySupply(world));
  });

  it("show destroyed money as flowing to Money destruction", () => {
    // Retail Credit lends to Households that cannot repay, so Write-offs destroy money.
    const world = run(
      step(createWorld(42), [
        { type: "monetize", amount: 2000 },
        { type: "industryLoan", industryId: "agriculture", amount: 1000 },
      ]).world,
      200,
    );
    const flows = moneyFlows(world, 0, world.tick);
    expect(flows.destroyed).toBeGreaterThan(0);
    expect(flows.links.some((l) => l.to === "Money destruction")).toBe(true);
    expect(flows.links.some((l) => l.from === "Money creation" && l.to === "Households")).toBe(true);
  });
});

describe("explanations", () => {
  it("explain an Industry failure with its cause and cost", () => {
    const failed = run(step(createWorld(42), fund(["manufacturing"], 5)).world, 8);
    expect(industries(failed).find((i) => i.id === "manufacturing")!.failed).toBe(true);
    const notes = explanations(failed).filter((n) => n.kind === "industryFailure");
    expect(notes).toHaveLength(1);
    expect(notes[0]!.text).toMatch(/Manufacturing/);
    expect(notes[0]!.text).toMatch(/could not afford/i);
    expect(notes[0]!.text).toMatch(/Industry Loan/);
  });

  it("explain each price rise of 10% or more by the supply and demand behind it", () => {
    let world = step(createWorld(42), fund(IDS)).world;
    let rises = 0;
    for (let t = 0; t < 120; t++) {
      const before = Object.fromEntries(productMarkets(world).map((p) => [p.id, p.price]));
      const prevCount = explanations(world).filter((n) => n.kind === "priceRise").length;
      world = step(world, []).world;
      const risen = productMarkets(world).filter((p) => before[p.id]! > 0 && p.price >= before[p.id]! * 1.1);
      const notes = explanations(world).filter((n) => n.kind === "priceRise").slice(prevCount);
      expect(notes).toHaveLength(risen.length);
      for (const p of risen) {
        expect(notes.some((n) => n.text.includes(p.name) && n.tick === world.tick - 1)).toBe(true);
      }
      rises += risen.length;
    }
    expect(rises).toBeGreaterThan(0);
  });
});

describe("history", () => {
  it("records money supply, prices, employment and welfare each Tick", () => {
    const world = run(step(createWorld(42), fund(IDS)).world, 30);
    const h = history(world);
    expect(h).toHaveLength(31);
    expect(h.map((p) => p.tick)).toEqual(Array.from({ length: 31 }, (_, i) => i));
    const first = moneyFlows(world, 0, 0);
    expect(h[0]!.moneySupply).toBe(first.created - first.destroyed);
    expect(h[0]!.moneySupply).toBeGreaterThanOrEqual(20_000 * IDS.length);
    expect(h.at(-1)!.moneySupply).toBe(moneySupply(world));
    expect(h.at(-1)!.employment).toBe(industries(world).reduce((s, i) => s + i.headcount, 0));
    expect(h.at(-1)!.employment).toBeGreaterThan(0);
    expect(h.at(-1)!.prices["grain"]).toBe(productMarkets(world).find((p) => p.id === "grain")!.price);
    const summary = countrySummary(world);
    expect(h.at(-1)).toMatchObject({ health: summary.health, hunger: summary.hunger, population: summary.population });
    // Welfare moves over time rather than being a constant.
    expect(new Set(h.map((p) => p.hunger)).size).toBeGreaterThan(1);
  });
});
