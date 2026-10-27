import { describe, expect, it } from "vitest";
import {
  cohorts,
  commercialBank,
  createWorld,
  deserialize,
  industries,
  InvariantViolation,
  moneyHolders,
  moneyLog,
  moneySupply,
  serialize,
  step,
  type Command,
} from "./index";
import { stockOf } from "./industry";

describe("a new world", () => {
  it("starts with no money", () => {
    const world = createWorld(42);
    expect(moneySupply(world)).toBe(0);
  });
});

describe("Monetization", () => {
  it("creates money held by the Treasury and logs it with its cause", () => {
    const { world } = step(createWorld(42), [{ type: "monetize", amount: 1000 }]);

    expect(moneySupply(world)).toBe(1000);
    expect(moneyHolders(world).find((h) => h.holder === "Treasury")?.balance).toBe(1000);
    expect(moneyLog(world)).toEqual([
      { tick: 0, direction: "created", amount: 1000, cause: "Monetization" },
    ]);
  });
});

describe("a Grant", () => {
  it("moves money from the Treasury to a Household Cohort without changing the supply", () => {
    const start = createWorld(42);
    const cohort = cohorts(start)[0]!;
    const { world } = step(start, [
      { type: "monetize", amount: 1000 },
      { type: "grant", cohortId: cohort.id, amount: 400 },
    ]);

    expect(moneySupply(world)).toBe(1000);
    expect(moneyHolders(world)).toEqual(
      expect.arrayContaining([
        { holder: "Treasury", balance: 600 },
        { holder: cohort.name, balance: 400 },
      ]),
    );
    expect(moneyLog(world)).toHaveLength(1);
  });

  it("is rejected when the Treasury cannot cover it", () => {
    const start = createWorld(42);
    const cohort = cohorts(start)[0]!;
    expect(() => step(start, [{ type: "grant", cohortId: cohort.id, amount: 1 }])).toThrow(/negative/);
  });
});

describe("commands", () => {
  it.each([0, -50, 1.5, 1e20])("reject an amount of %s", (amount) => {
    const world = createWorld(1);
    const cohort = cohorts(world)[0]!;
    expect(() => step(world, [{ type: "monetize", amount }])).toThrow(/amount/);
    expect(() => step(world, [{ type: "grant", cohortId: cohort.id, amount }])).toThrow(/amount/);
  });
});

describe("determinism and saves", () => {
  const script: Command[][] = [
    [{ type: "monetize", amount: 5000 }],
    [],
    [{ type: "grant", cohortId: "cohort-1", amount: 1200 }],
    [{ type: "monetize", amount: 300 }],
  ];
  const run = (start: ReturnType<typeof createWorld>, commands: Command[][]) =>
    commands.reduce((w, c) => step(w, c).world, start);

  it("gives identical results for the same seed and commands", () => {
    expect(serialize(run(createWorld(7), script))).toBe(serialize(run(createWorld(7), script)));
  });

  it("round-trips through a save and continues identically", () => {
    const midway = run(createWorld(7), script.slice(0, 2));
    const loaded = deserialize(serialize(midway));
    expect(serialize(loaded)).toBe(serialize(midway));
    expect(serialize(run(loaded, script.slice(2)))).toBe(serialize(run(createWorld(7), script)));
  });

  it("fails loudly on a save whose ledger does not balance", () => {
    const save = JSON.parse(serialize(run(createWorld(7), script)));
    save.ledger.balances["treasury:money"] += 1;
    expect(() => deserialize(JSON.stringify(save))).toThrow(InvariantViolation);
  });
});

describe("Agriculture", () => {
  const industry = (world: ReturnType<typeof createWorld>) => industries(world).find((i) => i.id === "agriculture")!;
  const funded = () => step(createWorld(42), [{ type: "monetize", amount: 2000 }, { type: "industryLoan", industryId: "agriculture", amount: 1000 }]).world;

  it("does nothing until it is started by an Industry Loan", () => {
    const { world } = step(createWorld(42), [{ type: "monetize", amount: 2000 }]);
    expect(industry(world)).toMatchObject({ started: false, headcount: 0 });
    expect(industry(world).lines.every((l) => l.batches.length === 0)).toBe(true);
  });

  it("is funded by an Industry Loan, which moves money without creating any", () => {
    const world = funded();
    // Only Retail Credit deposits from the Commercial Bank add to what the Central Bank issued.
    expect(moneySupply(world) - commercialBank(world).deposits).toBe(2000);
    expect(industry(world).loanOwed).toBe(1000);
    expect(moneyHolders(world).find((h) => h.holder === "Treasury")?.balance).toBe(1000);
  });

  it("rejects a loan the Treasury cannot cover", () => {
    expect(() => step(createWorld(42), [{ type: "industryLoan", industryId: "agriculture", amount: 5 }])).toThrow(/negative/);
  });

  it("rejects a loan to an unknown Industry", () => {
    expect(() => step(createWorld(42), [{ type: "industryLoan", industryId: "nope", amount: 5 }])).toThrow(/Unknown Industry/);
  });

  it("bootstraps from zero money to a first sale: hires, pays wages, produces and sells grain", () => {
    const world = funded();
    const a = industry(world);
    expect(a.headcount).toBeGreaterThan(0);
    expect(a.wagesPaid).toBe(a.headcount * a.wage);
    const grain = a.lines.find((l) => l.productId === "grain")!;
    expect(grain.sold).toBeGreaterThan(0);
    expect(grain.price).toBeGreaterThan(0);
    expect(stockOf(grain)).toBe(grain.produced - grain.sold);
    // The sales returned money to the Industry.
    expect(a.money).toBe(1000 - a.wagesPaid + a.lines.reduce((s, l) => s + l.sold * l.price, 0));
  });

  it("keeps the money supply fixed while money circulates over many Ticks", () => {
    let world = funded();
    for (let i = 0; i < 60; i++) world = step(world, []).world;
    expect(moneySupply(world) - commercialBank(world).deposits).toBe(2000);
    expect(industry(world).money).toBeGreaterThanOrEqual(0);
  });

  it("discovers a price from demand, not from cost: the price rises above unit cost", () => {
    const a = industry(step(funded(), []).world);
    const grain = a.lines.find((l) => l.productId === "grain")!;
    expect(grain.price).toBeGreaterThan(a.wage / grain.yield);
  });

  it("is deterministic and survives a save", () => {
    const a = serialize(funded());
    expect(a).toBe(serialize(funded()));
    const loaded = deserialize(a);
    expect(serialize(step(loaded, []).world)).toBe(serialize(step(funded(), []).world));
  });

  it("rejects a save that predates Industries", () => {
    const save = JSON.parse(serialize(createWorld(7)));
    delete save.industries;
    expect(() => deserialize(JSON.stringify(save))).toThrow(/Industries/);
  });
});
