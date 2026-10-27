import { describe, expect, it } from "vitest";
import { cohortViews, createWorld, debtBurdens, governmentDebt, industries, moneyHolders, moneyLog, moneySupply, priceIndex, step, type Command, type World } from "./index";

const IDS = ["agriculture", "mining-energy", "manufacturing", "construction", "retail-logistics", "healthcare-education", "research-labs"];
const WORKERS = "cohort-0";

const fund = (ids: string[], each = 20_000): Command[] => [
  { type: "monetize", amount: each * ids.length },
  ...ids.map((industryId): Command => ({ type: "industryLoan", industryId, amount: each })),
];
const run = (world: World, ticks: number, commands: Command[] = []) => {
  for (let i = 0; i < ticks; i++) world = step(world, i === 0 ? commands : []).world;
  return world;
};
const treasuryCash = (world: World) => moneyHolders(world).find((h) => h.holder === "Treasury")!.balance;
const cohortMoney = (world: World, id: string) => cohortViews(world).find((c) => c.id === id)!.money;

describe("retiring debt held by the Central Bank", () => {
  it("destroys the money, shrinks the debt and logs the event", () => {
    const { world: monetized } = step(createWorld(7), [{ type: "monetize", amount: 1000 }]);
    const { world, events } = step(monetized, [{ type: "retireDebt", holder: "centralBank", amount: 400 }]);

    expect(moneySupply(world)).toBe(600);
    expect(treasuryCash(world)).toBe(600);
    expect(governmentDebt(world)).toMatchObject({ owed: 600, centralBank: 600 });
    expect(events).toEqual([{ tick: 1, direction: "destroyed", amount: 400, cause: "Debt retirement" }]);
    expect(moneyLog(world).at(-1)).toEqual(events[0]);
  });
});

describe("retiring debt held by households", () => {
  it("returns their cash and does not change the money supply", () => {
    const start = step(createWorld(7), [
      { type: "monetize", amount: 1000 },
      { type: "grant", cohortId: WORKERS, amount: 1000 },
    ]).world;
    const sold = step(start, [{ type: "issueDebt", holder: WORKERS, amount: 600 }]).world;
    expect(cohortMoney(sold, WORKERS)).toBe(400);
    expect(treasuryCash(sold)).toBe(600);
    expect(governmentDebt(sold)).toMatchObject({ owed: 1600, centralBank: 1000, households: 600 });
    expect(moneySupply(sold)).toBe(1000);

    const { world, events } = step(sold, [{ type: "retireDebt", holder: WORKERS, amount: 500 }]);
    expect(cohortMoney(world, WORKERS)).toBe(900);
    expect(governmentDebt(world)).toMatchObject({ centralBank: 1000, households: 100 });
    expect(moneySupply(world)).toBe(1000);
    expect(events).toEqual([]);
    expect(moneyLog(world).some((e) => e.direction === "destroyed")).toBe(false);
  });
});

describe("debt commands are checked", () => {
  const world = step(createWorld(7), [
    { type: "monetize", amount: 1000 },
    { type: "grant", cohortId: WORKERS, amount: 200 },
  ]).world;

  it("rejects retiring more than is held or than the Treasury can pay", () => {
    expect(() => step(world, [{ type: "retireDebt", holder: "centralBank", amount: 1001 }])).toThrow(/holds only/i);
    expect(() => step(world, [{ type: "retireDebt", holder: WORKERS, amount: 1 }])).toThrow(/holds only/i);
    const drained = step(world, [{ type: "grant", cohortId: WORKERS, amount: 800 }]).world;
    expect(() => step(drained, [{ type: "retireDebt", holder: "centralBank", amount: 1 }])).toThrow(/Treasury has only/i);
  });

  it("rejects selling debt a holder cannot pay for, or to the Central Bank, or an unknown holder", () => {
    expect(() => step(world, [{ type: "issueDebt", holder: WORKERS, amount: 201 }])).toThrow(/has only/i);
    expect(() => step(world, [{ type: "issueDebt", holder: "centralBank", amount: 1 }])).toThrow(/monetize/i);
    expect(() => step(world, [{ type: "issueDebt", holder: "nobody", amount: 1 }])).toThrow(/unknown/i);
    expect(() => step(world, [{ type: "retireDebt", holder: WORKERS, amount: 0.5 }])).toThrow(/whole number/i);
  });
});

describe("deflation", () => {
  // Each world holds the same 300000 of idle Treasury cash. One pays it out as a Grant, the other uses it to
  // retire Central Bank debt, so the second has 300000 less money in the economy. Price levels bounce around
  // Tick to Tick, so they are averaged over the 5th to 40th Tick and over several seeds.
  const POT = 300_000;
  const SEEDS = [1, 2, 3, 7, 42];
  const base = (seed: number) => run(step(createWorld(seed), [...fund(IDS), { type: "monetize", amount: POT }]).world, 25);
  const follow = (start: World, command: Command) => {
    let world = start;
    const worlds: World[] = [];
    for (let i = 0; i < 40; i++) {
      world = step(world, i === 0 ? [command] : []).world;
      if (i >= 4) worlds.push(world);
    }
    return { end: world, mean: (pick: (w: World) => number) => worlds.reduce((s, w) => s + pick(w), 0) / worlds.length };
  };
  const pairs = () =>
    SEEDS.map((seed) => {
      const start = base(seed);
      return {
        spent: follow(start, { type: "grant", cohortId: WORKERS, amount: POT }),
        retired: follow(start, { type: "retireDebt", holder: "centralBank", amount: POT }),
      };
    });
  const average = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  type Burden = ReturnType<typeof debtBurdens>;
  const ratio = (pick: (b: Burden) => { nominal: number; real: number }) => (w: World) => pick(debtBurdens(w)).real / pick(debtBurdens(w)).nominal;

  it("leaves about 300000 less money than paying the same cash out", () => {
    for (const { spent, retired } of pairs()) {
      expect(moneySupply(spent.end) - moneySupply(retired.end)).toBeGreaterThan(POT * 0.85);
    }
  });

  it("lowers prices compared with paying the cash out", () => {
    const all = pairs();
    const spent = average(all.map((p) => p.spent.mean(priceIndex)));
    const retired = average(all.map((p) => p.retired.mean(priceIndex)));
    expect(retired).toBeLessThan(spent * 0.95);
  });

  it("lets wages follow prices down, below the usual wage floor, as the money supply shrinks", () => {
    const wages = (w: World) => industries(w).reduce((s, i) => s + i.wage, 0);
    const lowest = (w: World) => Math.min(...industries(w).map((i) => i.wage));
    for (const { spent, retired } of pairs()) {
      expect(retired.mean(wages)).toBeLessThan(spent.mean(wages) * 0.9);
      // The cost-of-living floor is 8 a day, and without a contraction no wage goes under it.
      expect(spent.mean(lowest)).toBeGreaterThanOrEqual(8);
      expect(retired.mean(lowest)).toBeLessThan(8);
    }
  });

  it("raises the real burden of Industry Loans and Government debt, which are fixed in money", () => {
    const all = pairs();
    for (const pick of [(b: Burden) => b.industries, (b: Burden) => b.government]) {
      const spent = average(all.map((p) => p.spent.mean(ratio(pick))));
      const retired = average(all.map((p) => p.retired.mean(ratio(pick))));
      expect(retired).toBeGreaterThan(spent * 1.05);
    }
    // Where prices end up below their starting level, a debt weighs more than the sum that was borrowed.
    expect(average(all.map((p) => p.retired.mean(ratio((b) => b.industries))))).toBeGreaterThan(1);
  });

  it("keeps every balance non-negative and the ledger consistent, and any default is written off", () => {
    for (const { retired } of pairs()) {
      for (const i of industries(retired.end)) {
        expect(i.loanOwed).toBeGreaterThanOrEqual(0);
        if (i.failed) expect(i.laidOff).toBeGreaterThan(0);
      }
    }
  });
});
