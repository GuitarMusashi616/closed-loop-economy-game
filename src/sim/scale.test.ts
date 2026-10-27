import { describe, expect, it } from "vitest";
import { countrySummary, createWorld, moneyFlows, step, type World } from "./index";
import { CREATION } from "./ledger";

/**
 * Scale: ADR-0002 simulates ~100,000 citizens as Household Cohorts, so a Tick's cost must not depend on the
 * headcount, and must not grow with how long the game has been running. The playable target is at least
 * 10 Ticks per second at 1x speed in the Worker, i.e. a Tick (plus its snapshot) well inside 100 ms.
 */
const TICK_BUDGET_MS = 100;

function populous(): World {
  // Seeds draw three cohorts of 20,000 to 40,000 citizens, so look for one close to 100,000.
  for (let seed = 1; seed < 200; seed++) {
    const world = createWorld(seed);
    const { population } = countrySummary(world);
    if (population >= 95_000 && population <= 110_000) return world;
  }
  throw new Error("no seed with about 100,000 citizens");
}

function withFlowHistory(world: World, flows: number): World {
  const filler = Array.from({ length: flows }, (_, i) => ({ tick: Math.floor(i / 30), from: CREATION, to: "Treasury", amount: 1, cause: "filler" }));
  return { ...world, ledger: { ...world.ledger, flows: filler } };
}

describe("Ticks at about 100,000 citizens", () => {
  it("starts from a population of about 100,000", () => {
    const { population } = countrySummary(populous());
    expect(population).toBeGreaterThanOrEqual(95_000);
  });

  it("runs 300 Ticks of a funded economy far faster than 10 Ticks per second", () => {
    let world = populous();
    let commands: Parameters<typeof step>[1] = [
      { type: "monetize", amount: 20_000_000 },
      ...world.industries.map((i) => ({ type: "industryLoan" as const, industryId: i.id, amount: 1_000_000 })),
    ];
    const started = performance.now();
    for (let i = 0; i < 300; i++) {
      world = step(world, commands).world;
      commands = [];
    }
    const perTick = (performance.now() - started) / 300;
    expect(world.tick).toBe(300);
    expect(perTick).toBeLessThan(TICK_BUDGET_MS);
  });

  it("does not slow a Tick down as the money history grows", () => {
    // Two million recorded flows is roughly 10,000 Ticks of play.
    let busy = populous();
    let commands: Parameters<typeof step>[1] = [
      { type: "monetize", amount: 20_000_000 },
      ...busy.industries.map((i) => ({ type: "industryLoan" as const, industryId: i.id, amount: 1_000_000 })),
    ];
    for (let i = 0; i < 20; i++) {
      busy = step(busy, commands).world;
      commands = [];
    }
    const before = busy.ledger.flows!.length;
    const world = withFlowHistory(busy, 2_000_000);
    // Best of three, so a garbage collection or a busy CI machine does not decide the result.
    let elapsed = Infinity;
    let next = world;
    for (let i = 0; i < 3; i++) {
      const started = performance.now();
      next = step(world, []).world;
      elapsed = Math.min(elapsed, performance.now() - started);
    }
    // The Tick posts real transactions on top of the history.
    expect(next.ledger.flows!.length).toBeGreaterThan(2_000_000 + 10);
    expect(before).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(TICK_BUDGET_MS);
  });

  it("leaves the previous World untouched when it steps", () => {
    const world = withFlowHistory(createWorld(1), 10);
    step(world, [{ type: "monetize", amount: 1000 }]);
    expect(world.ledger.flows).toHaveLength(10);
    expect(world.tick).toBe(0);
  });

  it("reads a recent Sankey window without scanning the whole history", () => {
    const world = withFlowHistory(createWorld(1), 2_000_000);
    let best = Infinity;
    let view = moneyFlows(world, 66_636, 66_666);
    for (let i = 0; i < 5; i++) {
      const started = performance.now();
      view = moneyFlows(world, 66_636, 66_666);
      best = Math.min(best, performance.now() - started);
    }
    // A full scan of two million flows takes 30 ms or more.
    expect(best).toBeLessThan(10);
    expect(view.created).toBe(30 * 30 + 20);
  });
});
