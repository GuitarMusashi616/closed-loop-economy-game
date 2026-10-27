import { describe, expect, it } from "vitest";
import { cohortViews, commercialBank, createWorld, deserialize, durables, moneyLog, moneySupply, serialize, step, type Command, type World } from "./index";

const IDS = ["agriculture", "mining-energy", "manufacturing", "construction", "retail-logistics", "healthcare-education", "research-labs"];
const WORKERS = "cohort-0";
const RETIREES = "cohort-2";

const fund = (ids: string[], each = 20_000): Command[] => [
  { type: "monetize", amount: each * ids.length },
  ...ids.map((industryId): Command => ({ type: "industryLoan", industryId, amount: each })),
];
const run = (world: World, ticks: number, commands: Command[] = []) => {
  for (let i = 0; i < ticks; i++) world = step(world, i === 0 ? commands : []).world;
  return world;
};
const view = (world: World, id: string) => cohortViews(world).find((c) => c.id === id)!;
const dur = (world: World, id: string) => durables(world).find((d) => d.cohortId === id)!;
const grant = (cohortId: string, amount: number): Command => ({ type: "grant", cohortId, amount });
const topUp: Command[] = [{ type: "monetize", amount: 10_000 }];
/** Gives the sellers of houses and cars plenty of stock, since a purchase is a real sale that needs goods to draw down. */
const stocked = (world: World, units = 400): World => ({
  ...world,
  industries: world.industries.map((i) =>
    i.id === "construction" || i.id === "manufacturing"
      ? { ...i, lines: i.lines.map((l) => (l.productId === "buildings" || l.productId === "machinery" ? { ...l, batches: [units] } : l)) }
      : i,
  ),
});
/** A world where cohort-0 is short of houses and has cash to borrow with. */
const shortOfHouses = (housed = 0.5) => stocked(step(createWorld(42, { housed }), [...fund(IDS), ...topUp, grant(WORKERS, 5000)]).world);

describe("durables", () => {
  it("start as owned assets, so a new world still has no money", () => {
    const world = createWorld(42);
    expect(moneySupply(world)).toBe(0);
    const d = dur(world, WORKERS);
    expect(d.houses).toBeGreaterThan(0);
    expect(d.houseValue).toBe(d.houses * 800);
    expect(d.carValue).toBe(d.cars * 300);
    expect(view(world, WORKERS).homelessness).toBe(0);
  });

  it("depreciate, with the loss shown against the owner's equity", () => {
    const world = createWorld(42);
    const later = run(world, 30);
    const before = dur(world, WORKERS);
    const after = dur(later, WORKERS);
    expect(after.houses).toBe(before.houses);
    expect(after.houseValue).toBeLessThan(before.houseValue);
    expect(after.carValue).toBeLessThan(before.carValue);
    // Cars wear out faster than houses.
    expect(1 - after.carValue / before.carValue).toBeGreaterThan(1 - after.houseValue / before.houseValue);
  });
});

describe("Collateralised Loans", () => {
  it("fund a house for a cohort that lacks one, creating money and housing the citizens", () => {
    const start = createWorld(42, { housed: 0.5 });
    const world = shortOfHouses();
    const homeless = view(world, WORKERS).homelessness;
    expect(homeless).toBeGreaterThan(0.4);
    const next = run(world, 1);
    expect(dur(next, WORKERS).houses).toBe(dur(world, WORKERS).houses + 1);
    expect(dur(next, WORKERS).securedDebt).toBeGreaterThan(0);
    expect(moneyLog(next).some((e) => e.cause === "Collateralised Loan" && e.direction === "created" && e.amount === 800)).toBe(true);
    expect(view(next, WORKERS).homelessness).toBeLessThan(homeless);
    expect(dur(start, WORKERS).houses).toBeLessThan(dur(next, WORKERS).houses);
  });

  it("buy a real product: the house draws down Construction's stock and counts as its revenue", () => {
    const world = shortOfHouses();
    const stockOf = (w: World) => w.industries.find((i) => i.id === "construction")!.lines[0]!.batches.reduce((a, b) => a + b, 0);
    const before = stockOf(world);
    const next = run(world, 1);
    expect(dur(next, WORKERS).houses).toBe(dur(world, WORKERS).houses + 1);
    // Construction sold the house's buildings (4 units) at once, and the 800 is part of its revenue.
    expect(before - stockOf(next)).toBeGreaterThanOrEqual(4);
    expect(next.industries.find((i) => i.id === "construction")!.revenue).toBeGreaterThanOrEqual(800);
  });

  it("are not made while the builder has nothing in stock", () => {
    const world = step(createWorld(42, { housed: 0.5 }), [...fund(IDS), ...topUp, grant(WORKERS, 5000)]).world;
    expect(world.industries.find((i) => i.id === "construction")!.lines[0]!.batches.reduce((a, b) => a + b, 0)).toBe(0);
    const next = run(world, 1);
    expect(dur(next, WORKERS).houses).toBe(dur(world, WORKERS).houses);
    expect(moneyLog(next).some((e) => e.cause === "Collateralised Loan")).toBe(false);
  });

  it("use the low secured rate, so the borrower pays less interest than on Retail Credit", () => {
    const rates = commercialBank(createWorld(1)).rates;
    expect(rates.collateralised).toBeLessThan(rates.retail);
    // A higher secured spread makes the same borrowing cost more and earns the bank more.
    const cheap = run(shortOfHouses(), 10);
    const dear = run(stocked(step(createWorld(42, { housed: 0.5 }), [...fund(IDS), ...topUp, grant(WORKERS, 5000), { type: "setSpreads", collateralised: 1 }]).world), 10);
    expect(dur(dear, WORKERS).houses).toBe(dur(cheap, WORKERS).houses);
    expect(commercialBank(dear).equity).toBeGreaterThan(commercialBank(cheap).equity);
    expect(view(dear, WORKERS).money).toBeLessThan(view(cheap, WORKERS).money);
  });

  it("are repaid, which destroys the money the loan created", () => {
    const world = run(shortOfHouses(), 20);
    const repaid = moneyLog(world).filter((e) => e.cause === "Collateralised Loan repayment");
    expect(repaid.length).toBeGreaterThan(0);
    expect(repaid.every((e) => e.direction === "destroyed")).toBe(true);
    // Debt is below the sum of everything borrowed (one 800 house per Tick), so principal is coming off.
    const borrowed = moneyLog(world).filter((e) => e.cause === "Collateralised Loan").reduce((s, e) => s + e.amount, 0);
    expect(dur(world, WORKERS).securedDebt).toBeLessThan(borrowed);
  });

  it("are refused to a cohort that cannot afford the payments", () => {
    // Nothing has reached the retirees yet on the first Tick, so they hold no cash to make payments from.
    const world = step(createWorld(42, { housed: 0.5 }), fund(IDS)).world;
    expect(dur(world, RETIREES).securedDebt).toBe(0);
    expect(dur(world, RETIREES).houses).toBe(createWorld(42, { housed: 0.5 }).cohorts[2]!.houses);
    expect(view(world, RETIREES).homelessness).toBeGreaterThan(0.4);
  });

  it("seize collateral on default, with the bank taking the loss", () => {
    // Retirees have no income of their own, so once the cash they were given runs out they miss payments.
    let world = stocked(step(createWorld(42, { housed: 0.5 }), [...fund(IDS), ...topUp, grant(RETIREES, 300)]).world);
    let before = dur(world, RETIREES);
    let seized = false;
    for (let t = 0; t < 60 && !seized; t++) {
      before = dur(world, RETIREES);
      world = step(world, []).world;
      seized = dur(world, RETIREES).securedDebt < before.securedDebt - 800;
    }
    expect(seized).toBe(true);
    const after = dur(world, RETIREES);
    const drop = before.houseValue + before.carValue - (after.houseValue + after.carValue);
    expect(after.cars).toBeLessThan(before.cars);
    // The bank holds what the cohort lost (less one Tick of depreciation), and the loan is cleared.
    const held = world.ledger.balances["bank:repossessed"]!;
    expect(held).toBeGreaterThan(0.9 * drop);
    expect(held).toBeLessThanOrEqual(drop);
    expect(after.securedDebt).toBe(0);
    // Debt beyond the collateral is a Write-off, which destroys money.
    expect(moneyLog(world).some((e) => e.cause === "Write-off") || held >= before.securedDebt).toBe(true);
  });
});

describe("population", () => {
  it("has no births when the youngest cohort is entirely unhoused", () => {
    const housed = run(createWorld(7), 5);
    const unhoused = run(createWorld(7, { housed: 0 }), 5);
    expect(view(housed, WORKERS).births).toBeGreaterThan(0);
    expect(view(unhoused, WORKERS).births).toBe(0);
  });

  it("has no births when the youngest cohort is starving", () => {
    const base = createWorld(7);
    const starving = { ...base, cohorts: base.cohorts.map((c) => ({ ...c, hunger: 100 })) };
    expect(view(run(starving, 1), WORKERS).births).toBe(0);
    expect(view(run(base, 1), WORKERS).births).toBeGreaterThan(0);
  });

  it("moves citizens between age bands without creating or losing any", () => {
    const start = createWorld(7);
    const world = run(start, 20);
    const total = (w: World) => cohortViews(w).reduce((s, c) => s + c.population, 0);
    const flows = cohortViews(world).reduce((s, c) => s + c.births - c.deaths - c.emigrated, 0);
    expect(total(world)).toBe(total(start) + flows);
    expect(view(world, WORKERS).population + view(world, "cohort-1").population).not.toBe(
      view(start, WORKERS).population + view(start, "cohort-1").population + flows,
    );
  });

  it("is hurt by homelessness: unhoused cohorts lose health that housed ones keep", () => {
    const housed = run(createWorld(7), 10);
    const unhoused = run(createWorld(7, { housed: 0.2 }), 10);
    expect(view(unhoused, WORKERS).health).toBeLessThan(view(housed, WORKERS).health - 5);
    expect(view(unhoused, WORKERS).homelessness).toBeGreaterThan(0.5);
  });
});

describe("pensions", () => {
  it("default to nothing", () => {
    expect(step(createWorld(1), [{ type: "monetize", amount: 1000 }]).world.pensionsPaid).toBe(0);
  });

  it("pay each retiree the set rate from the Treasury, to retirees only, without changing the supply", () => {
    const start = step(createWorld(42), [{ type: "monetize", amount: 1_000_000 }]).world;
    const retirees = view(start, RETIREES).population;
    const { world } = step(start, [{ type: "setPensionRate", rate: 0.5 }]);
    const paid = Math.floor(retirees * 0.5);
    expect(world.pensionsPaid).toBe(paid);
    expect(view(world, RETIREES).money).toBeGreaterThanOrEqual(paid);
    expect(view(world, "cohort-1").money).toBe(0);
    expect(world.ledger.balances["treasury:money"]).toBe(1_000_000 - paid);
    expect(moneySupply(world)).toBe(1_000_000);
  });

  it("pay no more than the Treasury holds", () => {
    const start = step(createWorld(42), [{ type: "monetize", amount: 100 }]).world;
    const { world } = step(start, [{ type: "setPensionRate", rate: 5 }]);
    expect(world.pensionsPaid).toBe(100);
    expect(world.ledger.balances["treasury:money"]).toBe(0);
  });

  it("reject a negative or non-finite rate", () => {
    for (const rate of [-1, NaN, Infinity]) {
      expect(() => step(createWorld(1), [{ type: "setPensionRate", rate }])).toThrow(/pension/i);
    }
  });

  it("keep retirees fed on their own money instead of Retail Credit", () => {
    const funded = [...fund(IDS), { type: "monetize", amount: 400_000 } as Command];
    const without = run(step(createWorld(42), funded).world, 5);
    const withPension = run(step(createWorld(42), [...funded, { type: "setPensionRate", rate: 0.3 }]).world, 5);
    const debt = (w: World) => w.ledger.balances[`${RETIREES}:loanOwed`]!;
    expect(withPension.pensionsPaid).toBeGreaterThan(0);
    expect(debt(withPension)).toBeLessThan(debt(without));
    expect(view(withPension, RETIREES).hunger).toBeLessThanOrEqual(view(without, RETIREES).hunger);
  });

  it("survive a save and load", () => {
    const { world } = step(createWorld(3), [{ type: "setPensionRate", rate: 0.25 }]);
    expect(deserialize(serialize(world)).pensionRate).toBe(0.25);
  });
});
