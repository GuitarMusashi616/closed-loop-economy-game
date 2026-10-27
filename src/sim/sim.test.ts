import { describe, expect, it } from "vitest";
import {
  cohorts,
  createWorld,
  deserialize,
  InvariantViolation,
  moneyHolders,
  moneyLog,
  moneySupply,
  serialize,
  step,
  type Command,
} from "./index";

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
  it.each([0, -50, 1.5])("reject an amount of %s", (amount) => {
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
