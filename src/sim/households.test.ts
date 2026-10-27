import { describe, expect, it } from "vitest";
import {
  cohortViews,
  countrySummary,
  createWorld,
  deserialize,
  sampleCitizen,
  serialize,
  step,
  type Command,
  type World,
} from "./index";

const run = (world: World, ticks: number, commands: Command[] = []) => {
  for (let i = 0; i < ticks; i++) world = step(world, i === 0 ? commands : []).world;
  return world;
};
const view = (world: World, id: string) => cohortViews(world).find((c) => c.id === id)!;
const population = (world: World) => countrySummary(world).population;

/** Agriculture funded and every cohort holding cash, so grain is bought. */
const fed = () =>
  run(createWorld(42), 1, [
    { type: "monetize", amount: 1_000_000 },
    { type: "industryLoan", industryId: "agriculture", amount: 5000 },
    { type: "grant", cohortId: "cohort-0", amount: 300_000 },
    { type: "grant", cohortId: "cohort-1", amount: 300_000 },
    { type: "grant", cohortId: "cohort-2", amount: 300_000 },
  ]);

describe("immigration", () => {
  it("brings a few newcomers a Tick into the youngest cohort when welfare is decent", () => {
    const start = fed();
    const world = run(start, 20);
    const young = view(world, "cohort-0");
    expect(young.immigrated).toBeGreaterThan(0);
    expect(countrySummary(world).immigrated).toBe(young.immigrated);
    // Low immigration: well under a percent of the cohort over those Ticks.
    expect(young.immigrated).toBeLessThan(view(start, "cohort-0").population * 0.01);
    expect(view(world, "cohort-1").immigrated).toBe(0);
  });

  it("stops when the cohort is hungry, thirsty or unhoused", () => {
    const base = fed();
    const arrivals = (change: object) => {
      const w = { ...base, cohorts: base.cohorts.map((c) => (c.id === "cohort-0" ? { ...c, ...change } : c)) };
      return view(run(w, 1), "cohort-0").immigrated - view(base, "cohort-0").immigrated;
    };
    expect(arrivals({})).toBeGreaterThan(0);
    expect(arrivals({ hunger: 60 })).toBe(0);
    expect(arrivals({ thirst: 60 })).toBe(0);
    expect(arrivals({ health: 40 })).toBe(0);
    expect(arrivals({ houses: 1 })).toBe(0);
  });

  it("is deterministic and accounted for: the population changes by births + immigrants - deaths - emigrants", () => {
    const start = fed();
    const a = run(start, 30);
    const b = run(start, 30);
    expect(a.cohorts).toEqual(b.cohorts);
    const net = (w: World) => cohortViews(w).reduce((s, c) => s + c.births + c.immigrated - c.deaths - c.emigrated, 0);
    expect(population(a) - population(start)).toBe(net(a) - net(start));
  });
});

describe("Household Cohorts and Welfare Stats", () => {
  it("starts healthy with every Welfare Stat reported per cohort", () => {
    const c = view(createWorld(42), "cohort-0");
    expect(c).toMatchObject({ health: 90, hunger: 0, thirst: 0, homelessness: 0, wealth: 0 });
    expect(c.education).toBeGreaterThan(0);
  });

  it("raises hunger when food is missing, which lowers health and then kills", () => {
    const start = createWorld(42);
    const early = run(start, 5);
    expect(view(early, "cohort-0").hunger).toBeGreaterThan(0);
    const late = run(early, 40);
    expect(view(late, "cohort-0").health).toBeLessThan(view(early, "cohort-0").health);
    expect(countrySummary(late).deaths).toBeGreaterThan(0);
    expect(population(late)).toBeLessThan(population(start));
  });

  it("raises thirst when water is missing", () => {
    const world = run(createWorld(42, { waterCoverage: 0 }), 5);
    expect(view(world, "cohort-1").thirst).toBeGreaterThan(0);
    const watered = run(createWorld(42), 5);
    expect(view(watered, "cohort-1").thirst).toBe(0);
  });

  it("feeds cohorts that buy grain better than cohorts that cannot", () => {
    const world = run(fed(), 10);
    expect(view(world, "cohort-0").hunger).toBeLessThan(view(run(createWorld(42), 11), "cohort-0").hunger);
  });

  it("causes emigration after sustained poor welfare, but not before", () => {
    const world = createWorld(42);
    expect(countrySummary(run(world, 3)).emigrated).toBe(0);
    expect(countrySummary(run(world, 60)).emigrated).toBeGreaterThan(0);
  });

  it("moves citizens between cohorts as they age, carrying their money", () => {
    const start = run(createWorld(42), 1, [
      { type: "monetize", amount: 100_000 },
      { type: "grant", cohortId: "cohort-1", amount: 100_000 },
    ]);
    const before = view(start, "cohort-2");
    const later = run(start, 10);
    const retirees = view(later, "cohort-2");
    expect(retirees.money).toBeGreaterThan(before.money);
    expect(retirees.population).toBeGreaterThan(view(start, "cohort-2").population - countrySummary(later).deaths);
    expect(view(later, "cohort-0").population).not.toBe(view(start, "cohort-0").population);
  });

  it("keeps the ledger valid and is deterministic across saves", () => {
    const a = run(fed(), 30);
    expect(serialize(a)).toBe(serialize(run(fed(), 30)));
    expect(serialize(step(deserialize(serialize(a)), []).world)).toBe(serialize(step(a, []).world));
  });

  it("rejects a save that predates Welfare Stats", () => {
    const save = JSON.parse(serialize(createWorld(7)));
    delete save.cohorts[0].health;
    expect(() => deserialize(JSON.stringify(save))).toThrow(/Welfare/);
  });
});

describe("zooming into a Citizen", () => {
  const world = run(fed(), 12);
  const cohort = view(world, "cohort-1");

  it("is deterministic", () => {
    expect(sampleCitizen(world, "cohort-1", 123)).toEqual(sampleCitizen(world, "cohort-1", 123));
  });

  it("differs between citizens but stays in range", () => {
    const a = sampleCitizen(world, "cohort-1", 1);
    const b = sampleCitizen(world, "cohort-1", 2);
    expect(a).not.toEqual(b);
    for (const c of [a, b]) {
      expect(c.health).toBeGreaterThanOrEqual(0);
      expect(c.health).toBeLessThanOrEqual(100);
      expect(c.hunger).toBeGreaterThanOrEqual(0);
      expect(c.wealth).toBeGreaterThanOrEqual(0);
    }
  });

  it("adds up to the cohort's totals across every citizen", () => {
    const sums = { health: 0, hunger: 0, thirst: 0, education: 0, wealth: 0 };
    for (let i = 0; i < cohort.population; i++) {
      const c = sampleCitizen(world, "cohort-1", i);
      for (const k of Object.keys(sums) as (keyof typeof sums)[]) sums[k] += c[k];
    }
    for (const k of Object.keys(sums) as (keyof typeof sums)[]) {
      expect(sums[k] / cohort.population).toBeCloseTo(cohort[k], 4);
    }
  });

  it("rejects an unknown cohort", () => {
    expect(() => sampleCitizen(world, "nope", 0)).toThrow(/Unknown Household Cohort/);
  });
});
