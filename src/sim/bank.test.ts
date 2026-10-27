import { describe, expect, it } from "vitest";
import {
  commercialBank,
  createWorld,
  deserialize,
  moneyLog,
  moneySupply,
  serialize,
  step,
  type Command,
  type World,
} from "./index";

const started = (extra: Command[] = []) =>
  step(createWorld(42), [
    { type: "monetize", amount: 2000 },
    { type: "industryLoan", industryId: "agriculture", amount: 1000 },
    ...extra,
  ]).world;

const run = (world: World, ticks: number) => {
  for (let i = 0; i < ticks; i++) world = step(world, []).world;
  return world;
};

const retailEvents = (world: World) => moneyLog(world).filter((e) => e.cause === "Retail Credit");

/** A world in which cohort-1 borrowed once and then received plenty of cash to service the loan. */
const cohortOneFlush = (policyRate: number) => {
  let world = run(started([{ type: "setPolicyRate", rate: policyRate }]), 1);
  world = step(world, [
    { type: "monetize", amount: 100_000 },
    { type: "grant", cohortId: "cohort-1", amount: 100_000 },
  ]).world;
  return world;
};

describe("Policy Rate and spreads", () => {
  it("feed through to the Commercial Bank's lending rates", () => {
    const base = commercialBank(createWorld(1));
    const { world } = step(createWorld(1), [{ type: "setPolicyRate", rate: 0.1 }]);
    const raised = commercialBank(world);
    expect(raised.policyRate).toBe(0.1);
    expect(raised.rates.retail).toBeCloseTo(base.rates.retail + 0.1 - base.policyRate);
    expect(raised.rates.collateralised).toBeLessThan(raised.rates.retail);

    const wider = commercialBank(step(world, [{ type: "setSpreads", retail: 0.3 }]).world).rates;
    expect(wider.retail).toBeCloseTo(0.4);
    expect(wider.collateralised).toBeCloseTo(raised.rates.collateralised);
  });

  it.each([-0.01, NaN, Infinity])("reject a rate of %s", (rate) => {
    expect(() => step(createWorld(1), [{ type: "setPolicyRate", rate }])).toThrow(/rate/);
    expect(() => step(createWorld(1), [{ type: "setSpreads", retail: rate }])).toThrow(/spread/);
  });
});

describe("Retail Credit", () => {
  it("lends to a cohort that lacks cash, creating a logged deposit", () => {
    const world = started();
    const created = retailEvents(world)
      .filter((e) => e.direction === "created")
      .reduce((s, e) => s + e.amount, 0);
    expect(created).toBeGreaterThan(0);
    expect(moneySupply(world)).toBe(2000 + created);
    expect(commercialBank(world).loans).toBe(created);
    expect(commercialBank(world).deposits).toBe(created);
  });

  it("is repaid, destroying the deposit and logging it, while interest accrues to bank equity", () => {
    const flush = cohortOneFlush(0.03);
    const before = commercialBank(flush);
    const world = step(flush, []).world;
    const after = commercialBank(world);
    expect(after.equity).toBeGreaterThan(before.equity);
    const repaid = moneyLog(world).filter(
      (e) => e.tick === flush.tick && e.cause === "Retail Credit repayment" && e.direction === "destroyed",
    );
    expect(repaid.reduce((s, e) => s + e.amount, 0)).toBeGreaterThan(0);
  });

  it("charges more interest at a higher Policy Rate", () => {
    const equityGain = (rate: number) => {
      const flush = cohortOneFlush(rate);
      return commercialBank(step(flush, []).world).equity - commercialBank(flush).equity;
    };
    expect(equityGain(0.2)).toBeGreaterThan(equityGain(0.01));
  });
});

describe("a default", () => {
  it("is written off, destroying money and reducing bank equity", () => {
    // Cohorts 1 and 2 never have income, so they cannot repay.
    const lent = started();
    const equityBefore = commercialBank(lent).equity;
    const world = run(lent, 200);
    const writeOffs = moneyLog(world).filter((e) => e.cause === "Write-off");
    expect(writeOffs.length).toBeGreaterThan(0);
    expect(writeOffs.every((e) => e.direction === "destroyed")).toBe(true);
    expect(commercialBank(world).equity).toBeLessThan(equityBefore);
  });
});

describe("a bank with too little equity", () => {
  it("stops lending", () => {
    // A bank wiped out by losses, built by editing the founding capital in a save.
    const save = JSON.parse(serialize(createWorld(42)));
    save.ledger.balances["bank:capital"] = 0;
    save.ledger.balances["bank:equity"] = 0;
    const world = run(
      step(deserialize(JSON.stringify(save)), [
        { type: "monetize", amount: 2000 },
        { type: "industryLoan", industryId: "agriculture", amount: 1000 },
      ]).world,
      20,
    );
    expect(commercialBank(world).lending).toBe(false);
    expect(retailEvents(world)).toEqual([]);
  });

  it("lends again only up to what its equity supports", () => {
    const bank = commercialBank(run(started(), 5));
    expect(bank.loans).toBeLessThanOrEqual(bank.equity * 10);
    expect(bank.lending).toBe(true);
  });
});

describe("saves", () => {
  it("round-trip with the Commercial Bank and reject saves that predate it", () => {
    const world = run(started(), 10);
    expect(serialize(deserialize(serialize(world)))).toBe(serialize(world));
    const save = JSON.parse(serialize(world));
    delete save.policy;
    expect(() => deserialize(JSON.stringify(save))).toThrow(/Commercial Bank/);
  });
});
