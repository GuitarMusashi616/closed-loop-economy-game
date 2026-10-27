import { describe, expect, it } from "vitest";
import { cohortViews, createWorld, industries, laborMarket, step, type Command, type World } from "./index";

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
const modify = (world: World, id: string, change: (i: World["industries"][number]) => object): World => ({
  ...world,
  industries: world.industries.map((i) => (i.id === id ? { ...i, ...change(i) } : i)),
});
/** A world where the two working-age cohorts hold exactly `workers` citizens between them. */
const withWorkforce = (world: World, workers: number): World => ({
  ...world,
  cohorts: world.cohorts.map((c) => (c.ageBand === "retired" ? c : { ...c, population: workers / 2 })),
});
/** Gives an Industry what it needs to staff `target` workers: inputs, Capacity and expected demand. */
const ready = (world: World, id: string, target: number, extra: object = {}): World =>
  modify(world, id, (i) => ({
    targetHeadcount: target,
    capacity: 100_000,
    inputStock: Object.fromEntries(i.lines.flatMap((l) => Object.keys(l.inputs)).map((p) => [p, 100_000])),
    lines: i.lines.map((l) => ({ ...l, expected: 100_000 })),
    ...extra,
  }));

describe("starting out", () => {
  it("has every working-age citizen unemployed and no retiree in the labor force", () => {
    const world = createWorld(5);
    const workingAge = cohortViews(world).filter((c) => c.ageBand !== "retired").reduce((s, c) => s + c.population, 0);
    expect(laborMarket(world)).toMatchObject({ laborForce: workingAge, employed: 0, unemployed: workingAge });
  });

  it("hires unemployed citizens into a started Industry, which pays them", () => {
    const start = createWorld(5);
    const world = step(start, fund(["agriculture"], 5000)).world;
    const agriculture = view(world, "agriculture");
    expect(agriculture.workers).toBe(10);
    const market = laborMarket(world);
    expect(market.employed).toBe(10);
    expect(market.unemployed).toBe(market.laborForce - 10);
    // Ten general laborers at the cost-of-living wage.
    expect(agriculture.wagesPaid).toBe(80);
  });
});

describe("Experience Types", () => {
  it("boost two Industries each, and Agriculture uses general labor", () => {
    const types = Object.fromEntries(industries(createWorld(1)).map((i) => [i.id, i.experienceType]));
    expect(types).toEqual({
      agriculture: null,
      "mining-energy": "scientist",
      manufacturing: "trades",
      construction: "trades",
      "retail-logistics": "professional",
      "healthcare-education": "professional",
      "research-labs": "scientist",
    });
  });

  it("grow with days worked, with diminishing returns, and lift productivity", () => {
    let world = step(createWorld(5), fund(["manufacturing"], 1_000_000)).world;
    const samples: number[] = [];
    for (let block = 0; block < 6; block++) {
      for (let t = 0; t < 20; t++) world = step(ready(world, "manufacturing", 10), []).world;
      samples.push(view(world, "manufacturing").experience);
    }
    const gains = samples.map((s, i) => s - (samples[i - 1] ?? 0));
    expect(gains[0]).toBeGreaterThan(0.05);
    for (let i = 1; i < gains.length; i++) expect(gains[i]).toBeLessThan(gains[i - 1]!);
    expect(gains.at(-1)).toBeGreaterThan(0);
    expect(samples.at(-1)).toBeLessThan(1);
    expect(view(world, "manufacturing").productivity).toBeGreaterThan(1.3);
  });

  it("lift output per worker, so experienced staff need fewer hands for the same plan", () => {
    const base = ready(step(createWorld(5), fund(["manufacturing"], 1_000_000)).world, "manufacturing", 30);
    // The first Tick hires; the plan then reflects the workers' productivity from the second.
    const twoTicks = (w: World) => step(ready(step(w, []).world, "manufacturing", 30), []).world;
    const green = twoTicks(base);
    const veteran = twoTicks(modify(base, "manufacturing", () => ({ workers: 30, skills: { manufacturing: 0.9 } })));
    const made = (w: World) => view(w, "manufacturing").lines.reduce((s, l) => s + l.produced, 0);
    const perWorker = (w: World) => made(w) / view(w, "manufacturing").headcount;
    expect(perWorker(veteran)).toBeGreaterThan(1.5 * perWorker(green));
  });

  it("do not boost Agriculture, which uses general labor", () => {
    const world = run(step(createWorld(5), fund(["agriculture"], 100_000)).world, 60);
    expect(view(world, "agriculture")).toMatchObject({ experience: 0, productivity: 1 });
  });

  const veteransMoveTo = (destination: string) => {
    const funded = step(createWorld(5), fund(["manufacturing", destination], 1_000_000)).world;
    let world = withWorkforce(funded, 100);
    world = ready(world, "manufacturing", 100, { workers: 100, skills: { manufacturing: 0.8 }, wage: 10 });
    world = ready(world, destination, 10, { wage: 30 });
    return view(step(world, []).world, destination);
  };

  it("partly transfer when a worker moves to the other Industry of the same Experience Type", () => {
    // Flow is a tenth of the pool a day, so ten Trades veterans fill the ten vacancies.
    const construction = veteransMoveTo("construction");
    expect(construction.workers).toBe(10);
    expect(construction.experience).toBeGreaterThan(0.3);
    expect(construction.experience).toBeLessThan(0.5);
  });

  it("do not transfer across Experience Types", () => {
    const healthcare = veteransMoveTo("healthcare-education");
    expect(healthcare.workers).toBe(10);
    expect(healthcare.experience).toBeLessThan(0.05);
  });

  it("decay while unemployed", () => {
    let world = withWorkforce(step(createWorld(5), fund(["manufacturing"], 1_000_000)).world, 20);
    world = modify(world, "manufacturing", () => ({ targetHeadcount: 0, workers: 20, skills: { manufacturing: 0.8 } }));
    world = step(world, []).world;
    expect(laborMarket(world).employed).toBe(0);
    const early = laborMarket(world).unemployedExperience.manufacturing!;
    expect(early).toBeGreaterThan(0.5);
    world = run(world, 30);
    const late = laborMarket(world).unemployedExperience.manufacturing!;
    expect(late).toBeLessThan(early * 0.8);
    expect(late).toBeGreaterThan(0);
  });
});

describe("wages", () => {
  it("start from cost of living plus amortized education, so Experience Types cost more than general labor", () => {
    const wages = Object.fromEntries(industries(createWorld(1)).map((i) => [i.id, i.wage]));
    expect(wages).toEqual({
      agriculture: 8,
      "mining-energy": 14,
      manufacturing: 10,
      construction: 10,
      "retail-logistics": 12,
      "healthcare-education": 12,
      "research-labs": 14,
    });
  });

  it("rise while an Industry cannot fill its jobs and settle back to the floor once it can", () => {
    let world = withWorkforce(step(createWorld(5), fund(["manufacturing"], 1_000_000)).world, 6);
    world = ready(world, "manufacturing", 10);
    const wages: number[] = [];
    for (let t = 0; t < 60; t++) {
      world = ready(world, "manufacturing", 10);
      world = step(world, []).world;
      wages.push(view(world, "manufacturing").wage);
    }
    expect(view(world, "manufacturing").workers).toBeCloseTo(6, 0);
    for (let i = 1; i < wages.length; i++) expect(wages[i]).toBeGreaterThanOrEqual(wages[i - 1]!);
    expect(wages.at(-1)).toBeGreaterThan(14);
    // More citizens arrive, so the jobs fill and the wage drifts back down, never under the floor.
    world = withWorkforce(world, 1000);
    const peak = view(world, "manufacturing").wage;
    for (let t = 0; t < 80; t++) world = step(ready(world, "manufacturing", 10), []).world;
    expect(view(world, "manufacturing").workers).toBe(10);
    expect(view(world, "manufacturing").wage).toBeLessThan(peak);
    expect(view(world, "manufacturing").wage).toBeGreaterThanOrEqual(10);
  });
});

describe("job matching", () => {
  const twoIndustries = (rival: number) => {
    // Twenty citizens, all employed in Manufacturing; Construction offers ten jobs at `rival` pay.
    let world = withWorkforce(step(createWorld(5), fund(["manufacturing", "construction"], 1_000_000)).world, 20);
    world = ready(world, "manufacturing", 20, { workers: 20, wage: 20 });
    world = ready(world, "construction", 10, { wage: rival });
    return world;
  };

  it("does not move workers for a pay gap under the switching margin", () => {
    const next = step(twoIndustries(21), []).world;
    expect(view(next, "construction").workers).toBe(0);
    expect(view(next, "manufacturing").workers).toBe(20);
  });

  it("moves a fractional share of workers a day when the pay gap is large", () => {
    let world = step(twoIndustries(40), []).world;
    expect(view(world, "construction").workers).toBeCloseTo(2, 5);
    expect(view(world, "manufacturing").workers).toBeCloseTo(18, 5);
    for (let t = 0; t < 60; t++) world = step(ready(ready(world, "construction", 10), "manufacturing", 20), []).world;
    expect(view(world, "construction").workers).toBeGreaterThan(8);
    expect(laborMarket(world).employed).toBeLessThanOrEqual(20);
  });

  it("prefers the candidate who is most productive for the wage", () => {
    let world = withWorkforce(step(createWorld(5), fund(["manufacturing", "construction"], 1_000_000)).world, 1000);
    world = ready(world, "manufacturing", 100, { workers: 100, wage: 10, skills: { manufacturing: 0.9 } });
    world = ready(world, "construction", 5, { wage: 20 });
    const next = step(world, []).world;
    // Ten veterans may switch a day, and they outrank the 900 green unemployed, so all five jobs go to veterans.
    expect(view(next, "construction").experience).toBeGreaterThan(0.4);
  });

  it("in a full run, hires only what Industries need, keeps the books balanced and builds experience where people work", () => {
    let world = step(createWorld(42), fund(IDS)).world;
    const worked = new Set<string>();
    for (let t = 0; t < 120; t++) {
      world = step(world, []).world;
      for (const i of industries(world)) if (i.headcount > 0) worked.add(i.id);
    }
    const market = laborMarket(world);
    const all = industries(world);
    expect(market.employed).toBeCloseTo(all.reduce((s, i) => s + i.workers, 0), 6);
    expect(market.employed + market.unemployed).toBeCloseTo(market.laborForce, 6);
    expect(all.filter((i) => i.failed)).toEqual([]);
    // A small economy leaves nearly everyone unemployed, and Agriculture, which feeds everyone, employs the most.
    expect(market.unemployed).toBeGreaterThan(0.99 * market.laborForce);
    expect(all.find((i) => i.id === "agriculture")!.workers).toBe(Math.max(...all.map((i) => i.workers)));
    // Every Industry that ever ran has built experience, except Agriculture, which uses general labor.
    expect(worked.size).toBeGreaterThanOrEqual(5);
    for (const i of all.filter((x) => worked.has(x.id))) {
      if (i.experienceType) expect(i.experience).toBeGreaterThan(0);
      else expect(i.experience).toBe(0);
    }
    // Workers who lost their Industry's job keep (decaying) experience among the unemployed.
    expect(Object.values(market.unemployedExperience).every((v) => v >= 0 && v < 1)).toBe(true);
  });
});
