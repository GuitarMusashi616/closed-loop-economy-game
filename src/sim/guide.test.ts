import { describe, expect, it } from "vitest";
import { alerts, createWorld, leverStages, moneySupply, step, tutorial, type Command, type World } from "./index";

const run = (world: World, ticks: number, commands: Command[] = []): World => {
  let w = world;
  for (let i = 0; i < ticks; i++) w = step(w, i === 0 ? commands : []).world;
  return w;
};

describe("gradual lever unlock", () => {
  it("opens with spending, loans and Monetization, then taxes, then the Policy Rate", () => {
    const w0 = createWorld(1, { gradualUnlock: true });
    expect(leverStages(w0)).toEqual({ basics: true, taxes: false, policyRate: false });
    const w1 = run(w0, 12);
    expect(leverStages(w1)).toEqual({ basics: true, taxes: true, policyRate: false });
    const w2 = run(w1, 30);
    expect(leverStages(w2)).toEqual({ basics: true, taxes: true, policyRate: true });
  });

  it("rejects locked commands until they unlock", () => {
    const w0 = createWorld(1, { gradualUnlock: true });
    expect(() => step(w0, [{ type: "setTaxRates", income: 10 }])).toThrow(/locked/i);
    expect(() => step(w0, [{ type: "issueDebt", holder: "bank", amount: 10 }])).toThrow(/locked/i);
    expect(() => step(w0, [{ type: "setPolicyRate", rate: 0.05 }])).toThrow(/locked/i);
    expect(() => step(w0, [{ type: "setSpreads", retail: 0.1 }])).toThrow(/locked/i);
    // Basics are open from the start.
    expect(moneySupply(step(w0, [{ type: "monetize", amount: 500 }]).world)).toBe(500);

    const taxed = run(w0, 12);
    expect(step(taxed, [{ type: "setTaxRates", income: 10 }]).world.taxes.income).toBe(10);
    expect(() => step(taxed, [{ type: "setPolicyRate", rate: 0.05 }])).toThrow(/locked/i);
    const late = run(taxed, 30);
    expect(step(late, [{ type: "setPolicyRate", rate: 0.05 }]).world.policy.policyRate).toBe(0.05);
  });

  it("leaves every lever open in a default world", () => {
    const w = createWorld(1);
    expect(leverStages(w)).toEqual({ basics: true, taxes: true, policyRate: true });
    expect(step(w, [{ type: "setPolicyRate", rate: 0.05 }]).world.policy.policyRate).toBe(0.05);
  });
});

describe("tutorial", () => {
  it("walks from zero money to a started Agriculture Industry, ticking off steps as the player does them", () => {
    let w = createWorld(1, { gradualUnlock: true });
    expect(tutorial(w).map((s) => s.done)).toEqual([false, false, false, false]);
    expect(tutorial(w)[0]?.id).toBe("monetize");
    w = run(w, 1, [{ type: "monetize", amount: 5000 }]);
    expect(tutorial(w).map((s) => s.done)).toEqual([true, false, false, false]);
    w = run(w, 1, [{ type: "industryLoan", industryId: "agriculture", amount: 2000 }]);
    expect(tutorial(w).map((s) => s.done)).toEqual([true, true, false, false]);
    w = run(w, 1, [{ type: "grant", cohortId: "cohort-0", amount: 500 }]);
    expect(tutorial(w).map((s) => s.done)).toEqual([true, true, true, false]);
    w = run(w, 3);
    expect(tutorial(w).every((s) => s.done)).toBe(true);
  });
});

describe("alerts", () => {
  it("raises none at the start", () => {
    expect(alerts(createWorld(1))).toEqual([]);
  });

  it("raises a famine alert once the country goes hungry with no food bought", () => {
    let w = createWorld(1);
    let ticks = 0;
    while (!alerts(w).some((a) => a.id === "famine") && ticks < 400) {
      w = step(w, []).world;
      ticks++;
    }
    expect(alerts(w).some((a) => a.id === "famine")).toBe(true);
    expect(ticks).toBeGreaterThan(0);
  });

  it("does not raise famine for a fed country", () => {
    const w = run(createWorld(1), 3, [
      { type: "monetize", amount: 100000 },
      { type: "industryLoan", industryId: "agriculture", amount: 50000 },
      { type: "grant", cohortId: "cohort-0", amount: 20000 },
      { type: "grant", cohortId: "cohort-1", amount: 20000 },
      { type: "grant", cohortId: "cohort-2", amount: 10000 },
    ]);
    expect(alerts(w).some((a) => a.id === "famine")).toBe(false);
  });

  it("raises a banks-halt-lending alert when the Commercial Bank's equity is gone", () => {
    const w = createWorld(1);
    const broke: World = { ...w, ledger: { ...w.ledger, balances: { ...w.ledger.balances, "bank:equity": 0, "bank:capital": 0 } } };
    expect(alerts(broke).map((a) => a.id)).toContain("banksHaltLending");
    expect(alerts(w).map((a) => a.id)).not.toContain("banksHaltLending");
  });

  it("raises a mass-layoffs alert when employment falls by a fifth in a Tick", () => {
    const stat = (tick: number, employment: number) => ({
      tick, moneySupply: 0, prices: {}, employment, population: 1, health: 0, hunger: 0, thirst: 0, education: 0, wealth: 0,
    });
    const w = createWorld(1);
    expect(alerts({ ...w, history: [stat(0, 1000), stat(1, 900)] }).map((a) => a.id)).not.toContain("massLayoffs");
    expect(alerts({ ...w, history: [stat(0, 1000), stat(1, 700)] }).map((a) => a.id)).toContain("massLayoffs");
  });
});
