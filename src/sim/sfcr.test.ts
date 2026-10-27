import { describe, expect, it } from "vitest";
import { cohortViews, createWorld, governmentDebt, moneyFlows, moneySupply, sectoralBalance, industries, step, fiscal, type Command, type World } from "./index";

/**
 * Oracle tests against the Godley and Lavoie models SIM (chapter 3) and PC (chapter 4).
 *
 * Sources (read for this ticket, not recalled from memory):
 *  - SIM equations, parameters (Gd = 20, W = 1, alpha1 = 0.6, alpha2 = 0.4, theta = 0.2) and the printed
 *    baseline output: the sfcr README, github.com/joaomacalos/sfcr.
 *  - PC equations and parameters (r = 0.025, G = 20, alpha1 = 0.6, alpha2 = 0.4, theta = 0.2,
 *    lambda0 = 0.635, lambda1 = 0.05, lambda2 = 0.01): the sfcr vignette gl2-pc.Rmd. Its Bs equation adds
 *    the bill interest (G + r[-1] * Bs[-1]); the MacroStat page quoted in the research notes has a sign error.
 *    The book itself was not available, so these are published replications of it, not the book text.
 *
 * What these tests do and do not show is spelled out per describe block. In short: the game is not an
 * implementation of SIM or PC. Its households do not consume by alpha1 * YD + alpha2 * V(-1), its Government
 * does not buy output, and its bills pay no interest. So the reference models are first checked against
 * what sfcr publishes, and the game is then compared only on the parts that really are the same thing:
 * the accounting of money creation by Government deficit and Central Bank purchase of bills (PC), and the
 * tax and money-supply identities (SIM).
 */

// ---------------------------------------------------------------------------------------------------
// Reference model SIM
// ---------------------------------------------------------------------------------------------------

interface SimParams { G: number; W: number; alpha1: number; alpha2: number; theta: number }
const SIM: SimParams = { G: 20, W: 1, alpha1: 0.6, alpha2: 0.4, theta: 0.2 };

function runSim(p: SimParams, periods: number) {
  // Period 1 is the all-zero initial state, as in sfcr.
  const rows = [{ Y: 0, YD: 0, C: 0, TX: 0, N: 0, Hh: 0, Hs: 0 }];
  for (let t = 1; t < periods; t++) {
    const prev = rows[t - 1]!;
    // Y = C + G, C = alpha1 * YD + alpha2 * Hh(-1), YD = (1 - theta) * W * N, N = Y / W, solved for Y.
    const Y = (p.G + p.alpha2 * prev.Hh) / (1 - p.alpha1 * (1 - p.theta));
    const N = Y / p.W;
    const TX = p.theta * p.W * N;
    const YD = p.W * N - TX;
    const C = p.alpha1 * YD + p.alpha2 * prev.Hh;
    rows.push({ Y, YD, C, TX, N, Hh: prev.Hh + YD - C, Hs: prev.Hs + p.G - TX });
  }
  return rows;
}

describe("reference model SIM against what sfcr publishes", () => {
  const sim = runSim(SIM, 80);

  it("reproduces the sfcr README's printed baseline (periods 2, 3, 4 and 10)", () => {
    // Printed to one decimal: period -> [YD, Hh].
    const printed: Record<number, [number, number]> = { 2: [30.8, 12.3], 3: [38.3, 22.7], 4: [44.8, 31.5], 10: [67.1, 62.2] };
    for (const [period, [yd, hh]] of Object.entries(printed)) {
      const row = sim[Number(period) - 1]!;
      expect(Math.abs(row.YD - yd)).toBeLessThan(0.05);
      expect(Math.abs(row.Hh - hh)).toBeLessThan(0.05);
    }
  });

  it("settles at the published steady state Y = 100, YD = 80, Hh = 80, with Hh = Hs throughout", () => {
    const last = sim[sim.length - 1]!;
    expect(last.Y).toBeCloseTo(100, 3);
    expect(last.YD).toBeCloseTo(80, 3);
    expect(last.Hh).toBeCloseTo(80, 3);
    for (const row of sim) expect(row.Hh).toBeCloseTo(row.Hs, 9);
  });
});

// ---------------------------------------------------------------------------------------------------
// Reference model PC
// ---------------------------------------------------------------------------------------------------

interface PcParams { r: number; G: number; alpha1: number; alpha2: number; theta: number; lambda0: number; lambda1: number; lambda2: number }
const PC: PcParams = { r: 0.025, G: 20, alpha1: 0.6, alpha2: 0.4, theta: 0.2, lambda0: 0.635, lambda1: 0.05, lambda2: 0.01 };

interface PcRow { Y: number; YD: number; C: number; TX: number; V: number; Bh: number; Hh: number; Bs: number; Bcb: number; Hs: number; G: number }
const ZERO: PcRow = { Y: 0, YD: 0, C: 0, TX: 0, V: 0, Bh: 0, Hh: 0, Bs: 0, Bcb: 0, Hs: 0, G: 0 };

/** Solves each period's simultaneous equations by Gauss-Seidel iteration, as sfcr does, from the previous period's values. */
function runPc(p: PcParams, periods: number): PcRow[] {
  const rows: PcRow[] = [ZERO];
  for (let t = 1; t < periods; t++) {
    const prev = rows[t - 1]!;
    let { Y, YD, C, TX, V, Bh } = { ...prev, Y: prev.Y, V: prev.V + 1 };
    for (let i = 0; i < 500; i++) {
      Y = C + p.G;
      TX = p.theta * (Y + p.r * prev.Bh);
      YD = Y - TX + p.r * prev.Bh;
      C = p.alpha1 * YD + p.alpha2 * prev.V;
      V = prev.V + YD - C;
      Bh = V * (p.lambda0 + p.lambda1 * p.r - p.lambda2 * (YD / V));
    }
    const Bs = prev.Bs + (p.G + p.r * prev.Bs) - (TX + p.r * prev.Bcb);
    const Bcb = Bs - Bh;
    rows.push({ Y, YD, C, TX, V, Bh, Hh: V - Bh, Bs, Bcb, Hs: prev.Hs + Bcb - prev.Bcb, G: p.G });
  }
  return rows;
}

describe("reference model PC against sfcr's own validation checks", () => {
  const pc = runPc(PC, 71);

  it("fulfils the hidden equation Hh = Hs every period (sfcr: 'the accounting part of the model is water tight')", () => {
    for (const row of pc) expect(Math.abs(row.Hh - row.Hs)).toBeLessThan(1e-6);
  });

  it("satisfies equation 4.6A, Hh = V * ((1 - lambda0) - lambda1 * r + lambda2 * YD / V)", () => {
    for (const row of pc.slice(1)) {
      const hh = row.V * (1 - PC.lambda0 - PC.lambda1 * PC.r + PC.lambda2 * (row.YD / row.V));
      expect(Math.abs(row.Hh - hh)).toBeLessThan(1e-6);
    }
  });

  it("has transaction-flow matrix columns that sum to zero (sfcr_validate tfm)", () => {
    for (let t = 1; t < pc.length; t++) {
      const row = pc[t]!;
      const prev = pc[t - 1]!;
      const households = -row.C + row.Y + PC.r * prev.Bh - row.TX - (row.Hh - prev.Hh) - (row.Bh - prev.Bh);
      const government = -PC.G - PC.r * prev.Bs + PC.r * prev.Bcb + row.TX + (row.Bs - prev.Bs);
      const centralBank = (row.Hs - prev.Hs) - (row.Bcb - prev.Bcb);
      expect(Math.abs(households)).toBeLessThan(1e-6);
      expect(Math.abs(government)).toBeLessThan(1e-6);
      expect(Math.abs(centralBank)).toBeLessThan(1e-6);
    }
  });

  it("settles: the last period no longer moves wealth or bills", () => {
    const [a, b] = [pc[pc.length - 2]!, pc[pc.length - 1]!];
    // sfcr runs 70 periods and treats that as the steady state; the adjustment is geometric.
    expect(Math.abs(b.V - a.V)).toBeLessThan(0.05);
    expect(Math.abs(b.Y - a.Y)).toBeLessThan(0.05);
  });
});

// ---------------------------------------------------------------------------------------------------
// The game ledger against PC: Government deficit financed by households and the Central Bank
// ---------------------------------------------------------------------------------------------------

describe("the game ledger reproduces PC's balance sheets when the same financing is replayed", () => {
  /**
   * Comparable: PC's government column. Each period the Government spends G, households' savings rise by it,
   * households take Bh of the bills and the Central Bank holds the rest (Bcb = Bs - Bh), so base money
   * Hs rises by the change in Bcb. In the game that is: monetize (Central Bank buys bills, money created),
   * grant (the Treasury pays households), issueDebt (households buy bills with cash), and retireDebt from the
   * Central Bank (its bills are sold to households, which destroys the cash).
   *
   * Not comparable, so switched off: bill interest (the game's debt pays none, so r = 0) and taxes (the game
   * taxes wages, which need running Industries; theta = 0). With both zero PC still has its portfolio choice
   * (lambda0 - lambda2 * YD / V). The reference supplies each period's household bill holding Bh; the game must
   * come out with PC's Bs, Bcb, Hh and Hs from its own ledger. Output, consumption and income are PC's and are
   * not tested here: no Industry runs in this configuration.
   */
  const SCALE = 1000;
  const params: PcParams = { ...PC, r: 0, theta: 0 };
  const ref = runPc(params, 41);
  const HOLDERS = "cohort-1";

  function replay(): { world: World; checks: { t: number; Bs: number; Bh: number; Bcb: number; Hh: number; supply: number }[] } {
    let world = createWorld(7);
    const checks = [];
    for (let t = 1; t < ref.length; t++) {
      const bills = Math.round(ref[t]!.Bh * SCALE) - Math.round(ref[t - 1]!.Bh * SCALE);
      const G = params.G * SCALE;
      const commands: Command[] = [
        { type: "monetize", amount: G + Math.max(0, -bills) },
        { type: "grant", cohortId: HOLDERS, amount: G },
      ];
      if (bills > 0) {
        commands.push({ type: "issueDebt", holder: HOLDERS, amount: bills });
        commands.push({ type: "retireDebt", holder: "centralBank", amount: bills });
      } else if (bills < 0) {
        commands.push({ type: "retireDebt", holder: HOLDERS, amount: -bills });
      }
      world = step(world, commands).world;
      const debt = governmentDebt(world);
      checks.push({
        t,
        Bs: debt.owed,
        Bh: debt.households,
        Bcb: debt.centralBank,
        Hh: cohortViews(world).reduce((s, c) => s + c.money, 0),
        supply: moneySupply(world),
      });
    }
    return { world, checks };
  }

  it("matches Bs, Bh, Bcb, Hh and Hs of PC every period, to rounding of the bill holdings", () => {
    const { checks } = replay();
    expect(checks).toHaveLength(40);
    for (const c of checks) {
      const model = ref[c.t]!;
      // The reference is in model units; the game's whole-number ledger is 1000 times finer, so one unit is 0.001.
      expect(Math.abs(c.Bs - model.Bs * SCALE)).toBeLessThanOrEqual(1);
      expect(Math.abs(c.Bh - model.Bh * SCALE)).toBeLessThanOrEqual(1);
      expect(Math.abs(c.Bcb - model.Bcb * SCALE)).toBeLessThanOrEqual(1);
      expect(Math.abs(c.Hh - model.Hh * SCALE)).toBeLessThanOrEqual(1);
      expect(Math.abs(c.supply - model.Hs * SCALE)).toBeLessThanOrEqual(1);
    }
    // PC's identity Hh = Hs holds in the game as the money supply equals households' cash.
    const last = checks[checks.length - 1]!;
    expect(last.supply).toBe(last.Hh);
  });

  it("is a real comparison: the portfolio really moved, and Central Bank money really rose", () => {
    const { checks } = replay();
    const last = checks[checks.length - 1]!;
    expect(last.Bh).toBeGreaterThan(0);
    expect(last.Bcb).toBeGreaterThan(0);
    expect(last.supply).toBeGreaterThan(0);
    // Bills the households hold are not money: Hs = Bcb, not Bs.
    expect(last.supply).toBe(last.Bcb);
  });
});

// ---------------------------------------------------------------------------------------------------
// The game ledger against SIM identities
// ---------------------------------------------------------------------------------------------------

describe("the game ledger satisfies SIM's tax and money-stock identities in a running economy", () => {
  /**
   * Comparable: SIM's tax equation TXd = theta * W * Ns, and SIM's Hs = Hh (money is created only by
   * Government deficit, and every unit of it sits in someone's account). Not comparable: SIM's output path
   * (Y rising to G / theta). The game's households buy by need and willingness to pay, and the Government's
   * spending is grants and contracts rather than purchases of output, so there is no multiplier to compare.
   */
  const IDS = ["agriculture", "mining-energy", "manufacturing", "construction", "retail-logistics", "healthcare-education", "research-labs"];
  function economy(theta: number, ticks: number) {
    let world = createWorld(42);
    world = step(world, [
      { type: "monetize", amount: 20_000 * IDS.length },
      ...IDS.map((industryId): Command => ({ type: "industryLoan", industryId, amount: 20_000 })),
      { type: "setTaxRates", income: theta * 100 },
    ]).world;
    const taxes: { tax: number; wages: number }[] = [];
    for (let t = 0; t < ticks; t++) {
      world = step(world, []).world;
      taxes.push({ tax: fiscal(world).incomeTax, wages: industries(world).reduce((s, i) => s + i.wagesPaid, 0) });
    }
    return { world, taxes };
  }

  it("collects theta of the wage bill every Tick, to whole-unit rounding per Industry", () => {
    const { taxes } = economy(0.2, 40);
    const paid = taxes.filter((t) => t.wages > 0);
    expect(paid.length).toBeGreaterThan(20);
    for (const { tax, wages } of paid) {
      // Tax is floored per cohort per Industry, so it can fall short of theta * wages by under a unit each.
      expect(tax).toBeLessThanOrEqual(0.2 * wages + 1e-9);
      expect(0.2 * wages - tax).toBeLessThan(IDS.length * 3);
    }
  });

  it("holds the money supply equal to what was created less what was destroyed (Hs from the deficit alone)", () => {
    const { world } = economy(0.2, 40);
    const flows = moneyFlows(world, 0, world.tick);
    expect(flows.created).toBeGreaterThan(0);
    expect(moneySupply(world)).toBe(flows.created - flows.destroyed);
  });

  it("nets every sector's financial position to the Commercial Bank's founding capital, so each asset is someone's liability", () => {
    const { world } = economy(0.2, 40);
    const net = Object.values(sectoralBalance(world)).reduce((a, b) => a + b, 0);
    // The one asset with no liability behind it is the bank's founding capital (50,000), a non-money starting stock.
    expect(net).toBe(50_000);
  });
});
