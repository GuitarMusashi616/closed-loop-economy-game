import { describe, expect, it } from "vitest";
import { cohortViews, commercialBank, createWorld, education, industries, laborMarket, moneyHolders, moneyLog, moneySupply, step, type Command, type World } from "./index";

const HE = "healthcare-education";
const treasury = (w: World) => moneyHolders(w).find((h) => h.holder === "Treasury")!.balance;
const cashOf = (w: World, cohortId: string) => cohortViews(w).find((c) => c.id === cohortId)!.money;
const run = (world: World, ticks: number, commands: Command[] = []) => {
  for (let i = 0; i < ticks; i++) world = step(world, i === 0 ? commands : []).world;
  return world;
};
const modify = (world: World, id: string, change: (i: World["industries"][number]) => object): World => ({
  ...world,
  industries: world.industries.map((i) => (i.id === id ? { ...i, ...change(i) } : i)),
});

/** Healthcare and Education running with plenty of power and capacity, so only demand limits it. */
const schoolWorld = (treasuryMoney = 100_000): World => {
  let world = step(createWorld(7), [
    { type: "monetize", amount: 20_000 + treasuryMoney },
    { type: "industryLoan", industryId: HE, amount: 20_000 },
  ]).world;
  world = modify(world, HE, (i) => ({
    targetHeadcount: 10,
    capacity: 100_000,
    inputStock: { power: 100_000, education: 100_000 },
    lines: i.lines.map((l) => ({ ...l, expected: 100_000 })),
  }));
  return world;
};
const view = (w: World) => education(w);
const workingAge = (w: World) => cohortViews(w).filter((c) => c.ageBand !== "retired").reduce((s, c) => s + c.population, 0);

describe("buying education", () => {
  it("takes students out of the workforce while they study, and raises their education", () => {
    // The control world has the same citizens, births and ageing but no school, so only studying differs.
    const control = run(step(createWorld(7), [{ type: "monetize", amount: 120_000 }]).world, 3);
    const baseline = cohortViews(control).map((c) => c.education);
    const world = run(schoolWorld(), 3);

    const students = view(world).students;
    expect(students).toBeGreaterThan(0);
    // Retirees do not study, so the students are all working-age and the workforce shrinks by exactly that many.
    expect(cohortViews(world)[2]!.students).toBe(0);
    expect(laborMarket(world).laborForce).toBe(workingAge(world) - students);
    const gained = cohortViews(world).map((c, i) => c.education - baseline[i]!);
    expect(gained[0]).toBeGreaterThan(0);
    expect(gained[1]).toBeGreaterThan(0);
    expect(gained[2]).toBeCloseTo(0, 5);
  });

  it("charges the market price, which the cohort and the Industry both see on the ledger", () => {
    const start = step(schoolWorld(), [{ type: "grant", cohortId: "cohort-0", amount: 5000 }]).world;
    const world = step(start, []).world;
    const after = industries(world).find((i) => i.id === HE)!;
    const line = after.lines.find((l) => l.productId === "education")!;

    expect(line.sold).toBeGreaterThan(0);
    expect(line.price).toBeGreaterThanOrEqual(1);
    // Cohort-0 paid exactly price x units (no tax, loans or subsidies in this world, wages aside).
    expect(view(world).tuitionPaid).toBe(line.sold * line.price);
  });

  it("is demand the Industry produces for, since households tell it what to make", () => {
    const world = run(step(schoolWorld(), [{ type: "grant", cohortId: "cohort-0", amount: 50_000 }]).world, 6);
    expect(view(world).demand).toBeGreaterThan(0);
    const line = industries(world).find((i) => i.id === HE)!.lines.find((l) => l.productId === "education")!;
    expect(line.expected).toBeGreaterThan(0);
  });
});

describe("the full economy", () => {
  it("gives Healthcare and Education household customers, so it is no longer demand-starved", () => {
    const ids = ["agriculture", "mining-energy", "manufacturing", "construction", "retail-logistics", HE, "research-labs"];
    let world = step(createWorld(42), [
      { type: "monetize", amount: 20_000 * ids.length },
      ...ids.map((industryId): Command => ({ type: "industryLoan", industryId, amount: 20_000 })),
    ]).world;
    world = run(world, 60);
    const line = industries(world).find((i) => i.id === HE)!.lines.find((l) => l.productId === "education")!;
    expect(view(world).students).toBeGreaterThan(0);
    expect(line.sold).toBeGreaterThanOrEqual(view(world).students);
    expect(industries(world).find((i) => i.id === HE)!.failed).toBe(false);
  });
});

describe("Tuition Loans", () => {
  it("cost between the secured and Retail Credit rates, and the Government's own rate is below secured", () => {
    let world = schoolWorld();
    world = step(world, [{ type: "setGovernmentEducationLoans", enabled: true }]).world;
    const { rates } = commercialBank(world);
    const e = view(world);
    expect(e.tuitionRate).toBeGreaterThan(rates.collateralised);
    expect(e.tuitionRate).toBeLessThan(rates.retail);
    expect(e.governmentRate).toBeLessThan(rates.collateralised);
  });

  it("let a penniless cohort study on credit from the Commercial Bank, creating money", () => {
    const world = run(schoolWorld(), 3);
    expect(view(world).students).toBeGreaterThan(0);
    const debt = view(world).debt;
    expect(debt.bank).toBeGreaterThan(0);
    expect(debt.government).toBe(0);
    expect(moneyLog(world).some((e) => e.cause === "Tuition Loan" && e.direction === "created")).toBe(true);
    expect(commercialBank(world).loans).toBeGreaterThanOrEqual(debt.bank);
  });

  it("are repaid with interest by students who have cash, destroying the money again", () => {
    let world = run(schoolWorld(), 3);
    const owed = view(world).debt.bank;
    const supply = moneySupply(world);
    world = step(world, [{ type: "monetize", amount: 200_000 }, { type: "grant", cohortId: "cohort-0", amount: 100_000 }, { type: "grant", cohortId: "cohort-1", amount: 100_000 }]).world;
    expect(view(world).debt.bank).toBeLessThan(owed);
    expect(moneyLog(world).some((e) => e.cause === "Tuition Loan repayment" && e.direction === "destroyed")).toBe(true);
    // 200k was monetized and the repayment destroyed some of the deposits that funded the loans.
    expect(moneySupply(world)).toBeLessThan(supply + 200_000);
  });

  it("from the Government are made from the Treasury's money and leave the supply alone", () => {
    const world = run(schoolWorld(), 3, [{ type: "setGovernmentEducationLoans", enabled: true }]);
    const debt = view(world).debt;
    expect(debt.government).toBeGreaterThan(0);
    expect(debt.bank).toBe(0);
    expect(moneySupply(world)).toBe(120_000);
    expect(treasury(world)).toBeLessThan(100_000);
  });

  it("from the Government raise tuition over time compared with Commercial Bank credit", () => {
    const bank = run(schoolWorld(), 12);
    const gov = run(schoolWorld(), 12, [{ type: "setGovernmentEducationLoans", enabled: true }]);
    // Penniless citizens bid more when their loan is cheap, so tuition ends up higher.
    expect(view(gov).price).toBeGreaterThan(view(bank).price);
    expect(view(bank).price).toBeGreaterThan(0);
    expect(view(gov).debt.government).toBeGreaterThan(0);
    expect(view(bank).debt.government).toBe(0);
  });
});

describe("Public Funding Share", () => {
  it("makes the Treasury pay its share of tuition to the Industry, so students pay the rest", () => {
    const grant: Command[] = [{ type: "grant", cohortId: "cohort-0", amount: 20_000 }, { type: "setPublicFunding", service: "education", percent: 50 }];
    const start = step(schoolWorld(), grant).world;
    const before = treasury(start);
    const world = step(start, []).world;
    const e = view(world);
    const line = industries(world).find((i) => i.id === HE)!.lines.find((l) => l.productId === "education")!;
    const sold = line.sold;

    expect(sold).toBeGreaterThan(0);
    expect(e.publicShare.education).toBe(50);
    expect(e.publicSpending).toBeGreaterThan(0);
    expect(e.publicSpending + e.tuitionPaid).toBe(sold * line.price);
    expect(Math.abs(e.publicSpending - e.tuitionPaid)).toBeLessThanOrEqual(sold);
    expect(treasury(world)).toBe(before - e.publicSpending);
  });

  it("lets students who cannot afford market tuition study when the Treasury pays all of it", () => {
    const world = run(schoolWorld(), 3, [{ type: "setPublicFunding", service: "education", percent: 100 }]);
    expect(view(world).students).toBeGreaterThan(0);
    expect(view(world).debt.bank).toBe(0);
    expect(view(world).tuitionPaid).toBe(0);
  });

  it("is capped by what the Treasury holds", () => {
    const world = run(schoolWorld(0), 3, [{ type: "setPublicFunding", service: "education", percent: 100 }]);
    expect(treasury(world)).toBeGreaterThanOrEqual(0);
  });

  it("rejects a share outside 0 to 100", () => {
    expect(() => step(createWorld(1), [{ type: "setPublicFunding", service: "healthcare", percent: 101 }])).toThrow(/100/);
    expect(() => step(createWorld(1), [{ type: "setPublicFunding", service: "healthcare", percent: -1 }])).toThrow();
  });

  it("also pays its share of the healthcare the Industry sells", () => {
    let world = schoolWorld();
    world = step(world, [{ type: "monetize", amount: 20_000 }, { type: "industryLoan", industryId: "construction", amount: 20_000 }, { type: "setPublicFunding", service: "healthcare", percent: 50 }]).world;
    world = modify(world, "construction", (i) => ({
      targetHeadcount: 10,
      capacity: 100_000,
      inputStock: { metal: 100_000, power: 100_000, freight: 100_000 },
      lines: i.lines.map((l) => ({ ...l, expected: 100_000 })),
    }));
    const before = treasury(world);
    const next = step(world, []).world;
    const healthcare = industries(next).find((i) => i.id === HE)!.lines.find((l) => l.productId === "healthcare")!;
    expect(healthcare.sold).toBeGreaterThan(0);
    expect(view(next).healthcareFunding).toBe(Math.floor((healthcare.sold * healthcare.price * 50) / 100));
    expect(before - treasury(next)).toBe(view(next).healthcareFunding);
  });
});
