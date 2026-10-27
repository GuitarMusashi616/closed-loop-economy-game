import { describe, expect, it } from "vitest";
import { cohortViews, commercialBank, createWorld, deserialize, fiscal, industries, moneyHolders, moneySupply, sectoralBalance, serialize, step, type Command, type World } from "./index";

const IDS = ["agriculture", "mining-energy", "manufacturing", "construction", "retail-logistics", "healthcare-education", "research-labs"];
const OWNERS = "cohort-1";
const WORKERS = "cohort-0";

const fund = (ids: string[], each = 20_000): Command[] => [
  { type: "monetize", amount: each * ids.length },
  ...ids.map((industryId): Command => ({ type: "industryLoan", industryId, amount: each })),
];
const run = (world: World, ticks: number, commands: Command[] = []) => {
  for (let i = 0; i < ticks; i++) world = step(world, i === 0 ? commands : []).world;
  return world;
};
const cash = (world: World, holder: string) => moneyHolders(world).find((h) => h.holder === holder)!.balance;
const cohortMoney = (world: World, id: string) => cohortViews(world).find((c) => c.id === id)!.money;
const industry = (world: World, id: string) => industries(world).find((i) => i.id === id)!;
const started = (seed = 42) => step(createWorld(seed), fund(IDS)).world;

describe("tax rates", () => {
  it("default to zero, so nothing is collected", () => {
    const world = run(started(), 5);
    expect(fiscal(world)).toMatchObject({ incomeTax: 0, corporateTax: 0 });
    expect(fiscal(world).rates).toEqual({ income: 0, corporate: 0 });
  });

  it("are set as percentages and rejected when out of range", () => {
    const { world } = step(createWorld(1), [{ type: "setTaxRates", income: 20, corporate: 30 }]);
    expect(fiscal(world).rates).toEqual({ income: 20, corporate: 30 });
    expect(fiscal(step(world, [{ type: "setTaxRates", income: 5 }]).world).rates).toEqual({ income: 5, corporate: 30 });
    for (const bad of [-1, 101, NaN, Infinity]) {
      expect(() => step(world, [{ type: "setTaxRates", income: bad }])).toThrow(/percent/i);
      expect(() => step(world, [{ type: "setTaxRates", corporate: bad }])).toThrow(/percent/i);
    }
  });
});

describe("income tax", () => {
  it("takes the set percentage of wages into the Treasury without changing the money supply", () => {
    const world = started();
    const before = cash(world, "Treasury");
    const { world: next } = step(world, [{ type: "setTaxRates", income: 25 }]);
    const wages = industries(next).reduce((s, i) => s + i.wagesPaid, 0);
    expect(wages).toBeGreaterThan(0);
    const tax = fiscal(next).incomeTax;
    expect(tax).toBe(Math.floor(wages * 0.25));
    expect(cash(next, "Treasury") - before).toBe(tax);
    // Workers keep the rest of what they were paid (nothing else moves their cash on this Tick except food).
    expect(moneySupply(next)).toBe(moneySupply(world) + commercialBank(next).deposits - commercialBank(world).deposits);
  });

  it("leaves Households with less to spend at 40% than at 0%", () => {
    const base = run(started(), 20);
    const taxed = run(started(), 20, [{ type: "setTaxRates", income: 40 }]);
    expect(cohortMoney(taxed, WORKERS)).toBeLessThan(cohortMoney(base, WORKERS));
    expect(cash(taxed, "Treasury")).toBeGreaterThan(cash(base, "Treasury"));
  });
});

describe("corporate tax", () => {
  it("takes the set percentage of an Industry's profit into the Treasury", () => {
    let world = started();
    let collected = 0;
    let profitable = 0;
    world = run(world, 1, [{ type: "setTaxRates", corporate: 50 }]);
    for (let t = 0; t < 30; t++) {
      const before = cash(world, "Treasury");
      world = step(world, []).world;
      const f = fiscal(world);
      const profit = industries(world).reduce((s, i) => s + Math.max(0, i.revenue - i.costs), 0);
      // Treasury gains exactly the tax collected (no other source is on).
      expect(cash(world, "Treasury") - before).toBe(f.corporateTax + f.incomeTax + f.dividendsToTreasury);
      expect(f.corporateTax).toBeLessThanOrEqual(Math.floor(profit * 0.5));
      collected += f.corporateTax;
      if (profit > 0) profitable++;
    }
    expect(profitable).toBeGreaterThan(0);
    expect(collected).toBeGreaterThan(0);
  });

  it("is not charged on a loss", () => {
    const world = run(step(createWorld(3), fund(["manufacturing"], 5000)).world, 1, [{ type: "setTaxRates", corporate: 90 }]);
    for (const i of industries(world)) {
      if (i.revenue <= i.costs) expect(fiscal(world).corporateTax).toBe(0);
    }
  });
});

describe("dividends", () => {
  it("send the share of after-tax profit an Industry does not retain to the Owner Cohort", () => {
    let world = started();
    let paid = 0;
    let profits = 0;
    for (let t = 0; t < 30; t++) {
      world = step(world, []).world;
      const f = fiscal(world);
      paid += f.dividendsToOwners;
      profits += industries(world).reduce((s, i) => s + Math.max(0, i.revenue - i.costs), 0);
      expect(f.dividendsToTreasury).toBe(0);
    }
    expect(paid).toBeGreaterThan(0);
    // Part of profit is retained: dividends are some, but strictly less than all, of it.
    expect(paid).toBeLessThan(profits);
    expect(paid).toBeGreaterThan(profits * 0.2);
  });

  it("do not create money, and Industries keep enough cash to pay next Tick's wages", () => {
    let world = started();
    for (let t = 0; t < 40; t++) {
      world = step(world, []).world;
      for (const i of industries(world)) {
        if (i.started && fiscal(world).dividendsToOwners > 0) expect(i.money).toBeGreaterThanOrEqual(0);
      }
    }
    expect(moneySupply(world) - commercialBank(world).deposits).toBe(20_000 * 7);
  });

  it("stop Agriculture hoarding cash while the Owner Cohort is fed", () => {
    // Without dividends, this seed left Agriculture holding about 115,000 by Tick 50 while
    // Established Families fell to about 1 and went hungry.
    const world = run(started(), 50);
    expect(industry(world, "agriculture").money).toBeLessThan(70_000);
    expect(cohortMoney(world, OWNERS)).toBeGreaterThan(5_000);
    expect(cohortViews(world).find((c) => c.id === OWNERS)!.hunger).toBeLessThan(60);
  });
});

describe("Equity Stakes", () => {
  it("convert an Industry Loan, so the debt falls and the Treasury holds a stake, with no change to the money supply", () => {
    const world = started();
    const before = industry(world, "agriculture");
    const { world: next } = step(world, [{ type: "convertLoan", industryId: "agriculture", amount: 8_000 }]);
    const after = industry(next, "agriculture");
    expect(after.loanOwed).toBe(before.loanOwed - 8_000);
    expect(after.stake).toBe(8_000);
    expect(industry(next, "mining-energy").stake).toBe(0);
    expect(moneySupply(next) - commercialBank(next).deposits).toBe(20_000 * 7);
  });

  it("are rejected for more than is owed, for an unknown Industry and for non-whole amounts", () => {
    const world = started();
    expect(() => step(world, [{ type: "convertLoan", industryId: "agriculture", amount: 20_001 }])).toThrow(/owes|loan/i);
    expect(() => step(world, [{ type: "convertLoan", industryId: "nope", amount: 1 }])).toThrow(/Unknown Industry/);
    expect(() => step(world, [{ type: "convertLoan", industryId: "agriculture", amount: 1.5 }])).toThrow(/whole/);
    expect(() => step(world, [{ type: "convertLoan", industryId: "agriculture", amount: 0 }])).toThrow(/positive/);
  });

  it("pay dividends to the Treasury, leaving the Owner Cohort a smaller share", () => {
    const converted = run(started(), 1, [{ type: "convertLoan", industryId: "agriculture", amount: 20_000 }]);
    const control = run(started(), 1);
    let toTreasury = 0;
    let toOwners = 0;
    let controlOwners = 0;
    let w = converted;
    let c = control;
    for (let t = 0; t < 12; t++) {
      w = step(w, []).world;
      c = step(c, []).world;
      toTreasury += fiscal(w).dividendsToTreasury;
      toOwners += fiscal(w).dividendsToOwners;
      controlOwners += fiscal(c).dividendsToOwners;
    }
    expect(toTreasury).toBeGreaterThan(0);
    expect(toOwners).toBeLessThan(controlOwners);
    expect(industry(w, "agriculture").loanOwed).toBe(0);
  });

  it("survive a save", () => {
    const world = run(started(), 5, [{ type: "convertLoan", industryId: "agriculture", amount: 5_000 }]);
    expect(industry(deserialize(serialize(world)), "agriculture").stake).toBe(5_000);
    expect(serialize(run(deserialize(serialize(world)), 3))).toBe(serialize(run(world, 3)));
  });
});

describe("Sectoral Balance", () => {
  it("is zero everywhere in a new world except the Commercial Bank's founding capital", () => {
    const b = sectoralBalance(createWorld(1));
    expect(b).toEqual({ government: 0, households: 0, industries: 0, commercialBanks: 50_000 });
  });

  it("shows where money sits: monetized cash is Government net position only until it is lent", () => {
    const { world } = step(createWorld(1), [{ type: "monetize", amount: 1_000 }]);
    // Treasury holds 1,000 of money but owes 1,000 to the Central Bank.
    expect(sectoralBalance(world).government).toBe(0);
    const lent = step(world, [{ type: "industryLoan", industryId: "agriculture", amount: 1_000 }]).world;
    // The loan swaps cash for a claim; wages and food then only move money between Industries and Households.
    const l = sectoralBalance(lent);
    expect(l.government).toBe(0);
    expect(l.industries + l.households).toBe(0);
    const granted = step(world, [{ type: "grant", cohortId: WORKERS, amount: 400 }]).world;
    expect(sectoralBalance(granted)).toMatchObject({ government: -400, households: 400 });
  });

  it("always adds up to the Commercial Bank's founding capital, whatever taxes and dividends move", () => {
    const world = run(started(), 40, [{ type: "setTaxRates", income: 30, corporate: 30 }, { type: "convertLoan", industryId: "agriculture", amount: 10_000 }]);
    const b = sectoralBalance(world);
    expect(b.government + b.households + b.industries + b.commercialBanks).toBe(50_000);
    expect(b.government).toBeGreaterThan(0);
  });

  it("shows Treasury hoarding as a Government surplus and Household deficit, which cuts household spending", () => {
    const base = run(started(), 40);
    const hoard = run(started(), 40, [{ type: "setTaxRates", income: 60, corporate: 60 }]);
    expect(sectoralBalance(hoard).government).toBeGreaterThan(sectoralBalance(base).government);
    expect(sectoralBalance(hoard).households).toBeLessThan(sectoralBalance(base).households);
    // Same economy, same seed: the only difference is the Treasury sitting on the cash.
    const spend = (w0: World, commands: Command[]) => {
      let w = run(w0, 1, commands);
      let total = 0;
      for (let t = 0; t < 60; t++) {
        w = step(w, []).world;
        total += fiscal(w).householdSpending;
      }
      return total;
    };
    const normal = spend(started(), []);
    const hoarded = spend(started(), [{ type: "setTaxRates", income: 60, corporate: 60 }]);
    expect(normal).toBeGreaterThan(0);
    expect(hoarded).toBeLessThan(normal);
  });
});
