import { describe, expect, it } from "vitest";
import { createWorld, step, type Command, type World } from "../sim";
import { buildSnapshot } from "./snapshot";

/** Plays a funded economy so history, notes and flows fill up. */
function played(ticks: number): World {
  let world = createWorld(1);
  let commands: Command[] = [
    { type: "monetize", amount: 50_000_000 },
    ...world.cohorts.map((c) => ({ type: "grant" as const, cohortId: c.id, amount: 5_000_000 })),
    ...world.industries.map((i) => ({ type: "industryLoan" as const, industryId: i.id, amount: 1_000_000 })),
  ];
  for (let i = 0; i < ticks; i++) {
    world = step(world, commands).world;
    commands = [];
  }
  return world;
}

describe("the snapshot sent to the UI each Tick", () => {
  it("is built and structured-cloned well inside a 100 ms Tick after 3,000 Ticks of play", { timeout: 60_000 }, () => {
    const world = played(3000);
    const started = performance.now();
    const snapshot = buildSnapshot(world, 4, [], 30);
    const built = performance.now() - started;
    const cloneStart = performance.now();
    const copy = structuredClone(snapshot);
    const cloned = performance.now() - cloneStart;
    expect(copy.tick).toBe(3000);
    expect(built + cloned).toBeLessThan(50);
  });

  it("does not grow without bound as the game runs", { timeout: 60_000 }, () => {
    const sizeAt = (ticks: number) => JSON.stringify(buildSnapshot(played(ticks), 1, [], 30)).length;
    // Past the chart window, 2.5 times the Ticks must not mean more bytes for the UI thread to receive each Tick.
    expect(sizeAt(2500)).toBeLessThan(sizeAt(1000) * 1.2);
  });
});
