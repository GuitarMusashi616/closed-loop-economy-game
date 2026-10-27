import { describe, expect, it } from "vitest";
import { checkInvariants } from "./ledger";
import { InvariantViolation, createWorld, moneySupply, step, type Command, type World } from "./index";
import { seededRandom } from "./rng";
import technologyData from "./data/technologies.json";

const IDS = ["agriculture", "mining-energy", "manufacturing", "construction", "retail-logistics", "healthcare-education", "research-labs"];
const COHORTS = ["cohort-0", "cohort-1", "cohort-2"];
const PRODUCT_IDS = ["grain", "meat", "tools", "power", "buildings"];

/** A command drawn from the whole menu, with amounts that are sometimes too big so rejections happen too. */
function randomCommand(random: () => number): Command {
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const amount = () => 1 + Math.floor(random() * random() * 60_000);
  switch (Math.floor(random() * 15)) {
    case 0: return { type: "monetize", amount: amount() };
    case 1: return { type: "grant", cohortId: pick(COHORTS), amount: amount() };
    case 2: return { type: "industryLoan", industryId: pick(IDS), amount: amount() };
    case 3: return { type: "convertLoan", industryId: pick(IDS), amount: amount() };
    case 4: return { type: "setPolicyRate", rate: random() * 0.2 };
    case 5: return { type: "setSpreads", retail: random() * 0.1, collateralised: random() * 0.05 };
    case 6: return { type: "setTaxRates", income: Math.floor(random() * 60), corporate: Math.floor(random() * 60) };
    case 7: return { type: "setMarkup", target: pick([...PRODUCT_IDS, "wages"]), percent: Math.floor(random() * 120) - 50 };
    case 8: return { type: "setPublicFunding", service: pick(["healthcare", "education"] as const), percent: Math.floor(random() * 101) };
    case 9: return { type: "setGovernmentEducationLoans", enabled: random() < 0.5 };
    case 10: return { type: "issueDebt", holder: pick(["bank", ...COHORTS]), amount: amount() };
    case 11: return { type: "retireDebt", holder: pick(["bank", "centralBank", ...COHORTS]), amount: amount() };
    case 12: return { type: "setPensionRate", rate: random() * 2 };
    case 13: return { type: "setResearch", technologyIds: [pick(technologyData).id] };
    default: return { type: "monetize", amount: amount() * 5 };
  }
}

/** Every Account that is not equity is a real holding or debt and can never be negative. Equity is the residual and may be. */
function expectNothingNegative(world: World, label: string) {
  for (const account of world.ledger.accounts) {
    const balance = world.ledger.balances[account.id]!;
    expect(Number.isFinite(balance), `${label}: ${account.id} is finite`).toBe(true);
    if (account.kind !== "equity") expect(balance, `${label}: ${account.id}`).toBeGreaterThanOrEqual(0);
  }
  const assets = world.ledger.accounts.filter((a) => a.kind === "asset").reduce((s, a) => s + world.ledger.balances[a.id]!, 0);
  const claims = world.ledger.accounts.filter((a) => a.kind !== "asset").reduce((s, a) => s + world.ledger.balances[a.id]!, 0);
  expect(assets, `${label}: assets equal liabilities plus equity`).toBe(claims);
  // Physical quantities the ledger does not hold. A hair below zero is only floating-point dust.
  const dust = -1e-6;
  for (const c of world.cohorts) {
    expect(c.population, `${label}: ${c.id} population`).toBeGreaterThanOrEqual(0);
    expect(c.houses, `${label}: ${c.id} houses`).toBeGreaterThanOrEqual(0);
    expect(c.cars, `${label}: ${c.id} cars`).toBeGreaterThanOrEqual(0);
  }
  for (const i of world.industries) {
    for (const [name, value] of Object.entries({ workers: i.workers, headcount: i.headcount, target: i.targetHeadcount, capacity: i.capacity })) {
      expect(value, `${label}: ${i.id} ${name}`).toBeGreaterThanOrEqual(dust);
    }
    for (const [id, units] of Object.entries(i.inputStock)) expect(units, `${label}: ${i.id} input ${id}`).toBeGreaterThanOrEqual(dust);
    for (const l of i.lines) for (const n of l.batches) expect(n, `${label}: ${i.id} ${l.productId} stock`).toBeGreaterThanOrEqual(dust);
  }
}

describe("the founding balance sheet", () => {
  it("is written straight onto the ledger at Tick 0 but balances, holds no money, and passes the invariants", () => {
    for (const options of [{}, { housed: 0.5 }, { housed: 0 }]) {
      const world = createWorld(3, options);
      const sum = (kind: "asset" | "other") =>
        world.ledger.accounts.filter((a) => (kind === "asset") === (a.kind === "asset")).reduce((s, a) => s + world.ledger.balances[a.id]!, 0);
      expect(sum("asset")).toBe(sum("other"));
      expect(sum("asset")).toBeGreaterThan(0);
      expect(moneySupply(world)).toBe(0);
      expect(() => checkInvariants(world.ledger)).not.toThrow();
    }
  });
});

describe("per-Tick non-negativity", () => {
  it("holds through many Ticks, across seeds, with random commands from the whole menu, including rejected ones", () => {
    let applied = 0;
    let rejected = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const random = seededRandom(seed * 7919);
      let world = createWorld(seed, { housed: seed % 2 === 0 ? 1 : 0.6 });
      // A funded start so Industries run, then a command most Ticks.
      world = step(world, [{ type: "monetize", amount: 140_000 }, ...IDS.map((industryId): Command => ({ type: "industryLoan", industryId, amount: 20_000 }))]).world;
      for (let t = 0; t < 120; t++) {
        const commands = random() < 0.6 ? [randomCommand(random)] : [];
        try {
          world = step(world, commands).world;
          applied += commands.length;
        } catch (error) {
          // A refused command leaves the world exactly as it was; nothing about it may break the invariants.
          // The ledger refusing an overdraft is the designed rejection; any other invariant failure is a bug.
          if (error instanceof InvariantViolation) expect(error.message).toMatch(/is negative/);
          rejected++;
          world = step(world, []).world;
        }
        expectNothingNegative(world, `seed ${seed} tick ${t}`);
      }
    }
    // The scenarios really exercised both outcomes.
    expect(applied).toBeGreaterThan(100);
    expect(rejected).toBeGreaterThan(5);
  }, 30_000);

  it("holds when Industries fail and are restarted", () => {
    let world = step(createWorld(9), [{ type: "monetize", amount: 3_000 }, ...IDS.map((industryId): Command => ({ type: "industryLoan", industryId, amount: 400 }))]).world;
    for (let t = 0; t < 150; t++) {
      world = step(world, t % 40 === 20 ? [{ type: "industryLoan", industryId: IDS[t % 7]!, amount: 1 }] : []).world;
      expectNothingNegative(world, `failing economy tick ${t}`);
    }
    expect(world.industries.some((i) => i.failed || i.started)).toBe(true);
  });
});
