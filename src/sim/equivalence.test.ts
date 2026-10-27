import { describe, expect, it } from "vitest";
import { newCohort, runHouseholds, type AgeBand, type Cohort } from "./households";
import { seededRandom } from "./rng";

/**
 * Cohort-versus-individual equivalence (ADR-0002).
 *
 * The reference below simulates every citizen as an individual with their own health, hunger, thirst,
 * wealth and housing, restating the Household rules in the glossary per head: needs rise and fall with
 * how much of the food and water they need is met, deprivation damages health, citizens below a health
 * threshold die with a probability, the long-term poor emigrate, and a small share age into the next
 * cohort, carrying their own stats and wealth. Randomness is drawn per citizen (seeded), where the cohort
 * model uses the expected value.
 *
 * What it can prove: when citizens share a state, or differ only in ways the rules treat linearly, the
 * cohort's means, headcounts and money match the individual-level mean within sampling noise.
 * What it cannot prove: the rules are not linear. Death and the Welfare Stat clamps are thresholds, so a
 * cohort that is heterogeneous across a threshold (some housed, some not) is simulated by its mean, and
 * the individual reference disagrees. That gap is measured in the last test, not hidden.
 *
 * Conventions both sides share: food and water are shared out equally per head; the wealth of a citizen
 * who dies or emigrates stays in their cohort (the cohort's money account is not touched), so the
 * reference bequeaths it equally to the cohort's remaining citizens.
 */

interface Person {
  health: number;
  hunger: number;
  thirst: number;
  poorTicks: number;
  wealth: number;
  housed: boolean;
}

const clamp = (v: number) => Math.min(100, Math.max(0, v));

interface Setup {
  populations: number[];
  /** Share of the citizens each cohort houses, 0 to 1. */
  housing: number[];
  /** Share of each cohort's grain need that is met every Tick. */
  foodMet: number[];
  water: number;
  /** Spread of starting wealth: wealth is `mean * (1 + spread * (u - 0.5) * 2)` for uniform u. */
  wealthSpread: number;
  ticks: number;
}

const BANDS: AgeBand[] = ["young", "established", "retired"];
const MEAN_WEALTH = [100, 400, 250];

function reference(setup: Setup, seed: number) {
  const random = seededRandom(seed);
  const cohorts: Person[][] = setup.populations.map((n, c) =>
    Array.from({ length: n }, (_, i) => ({
      health: 90, hunger: 0, thirst: 0, poorTicks: 0,
      wealth: MEAN_WEALTH[c]! * (1 + setup.wealthSpread * (random() - 0.5) * 2),
      housed: i < Math.floor(n * setup.housing[c]!),
    })),
  );
  let deaths = 0;
  let emigrated = 0;
  for (let t = 0; t < setup.ticks; t++) {
    const bequests = cohorts.map(() => 0);
    const stayed: Person[][] = cohorts.map((people, c) => {
      const need = Math.floor(people.length * 0.01);
      const met = need === 0 ? 1 : Math.min(1, (setup.foodMet[c]! * need) / need);
      const survivors: Person[] = [];
      for (const p of people) {
        p.hunger = clamp(p.hunger + 8 * (1 - met) - 25 * met);
        p.thirst = clamp(p.thirst + 8 * (1 - setup.water) - 25 * setup.water);
        const strain = Math.max(p.hunger, p.thirst);
        p.health = clamp((strain >= 30 ? p.health - 0.05 * strain : p.health + 1) - (p.housed ? 0 : 2));
        const poor = p.health < 50 || p.hunger > 70 || p.thirst > 70;
        p.poorTicks = poor ? p.poorTicks + 1 : 0;
      }
      for (const p of people) {
        if (p.health < 60 && random() < ((60 - p.health) / 60) * 0.03) {
          deaths++;
          bequests[c]! += p.wealth;
        } else survivors.push(p);
      }
      const left: Person[] = [];
      for (const p of survivors) {
        if (p.poorTicks >= 7 && random() < 0.01) {
          emigrated++;
          bequests[c]! += p.wealth;
        } else left.push(p);
      }
      return left;
    });
    stayed.forEach((people, c) => {
      if (people.length > 0 && bequests[c]! > 0) for (const p of people) p.wealth += bequests[c]! / people.length;
    });
    // Ageing: a share of each cohort but the last moves on, carrying its own stats.
    const staying: Person[][] = stayed.map(() => []);
    const movers: Person[][] = stayed.map(() => []);
    stayed.forEach((people, c) => {
      for (const p of people) (c < stayed.length - 1 && random() < 0.0005 ? movers : staying)[c]!.push(p);
    });
    cohorts.length = 0;
    stayed.forEach((_, c) => cohorts.push([...staying[c]!, ...(c > 0 ? movers[c - 1]! : [])]));
    // Births join the youngest cohort when it is healthy, in proportion to housing and food security.
    const young = cohorts[0]!;
    if (young.length > 0) {
      const mean = (pick: (p: Person) => number) => young.reduce((s, p) => s + pick(p), 0) / young.length;
      if (mean((p) => p.health) >= 60) {
        const hungerMean = mean((p) => p.hunger);
        const security = 1 - Math.max(0, hungerMean - 30) / 70;
        const housedShare = mean((p) => (p.housed ? 1 : 0));
        const p = 0.0003 * housedShare * security;
        const n = young.length;
        for (let i = 0; i < n; i++) if (random() < p) young.push({ health: 100, hunger: 0, thirst: 0, poorTicks: 0, wealth: 0, housed: true });
      }
    }
    // Low immigration: while the youngest are healthy, fed, watered and housed, a few newcomers arrive with the group's mean
    // stats and nothing to their name. The gate keeps them to a cohort with spare housing, so they arrive housed.
    if (young.length > 0) {
      const mean = (pick: (p: Person) => number) => young.reduce((s, p) => s + pick(p), 0) / young.length;
      const unhoused = 1 - mean((p) => (p.housed ? 1 : 0));
      if (mean((p) => p.health) >= 70 && mean((p) => p.hunger) <= 20 && mean((p) => p.thirst) <= 20 && unhoused <= 0.05) {
        const arrival = { health: mean((p) => p.health), hunger: mean((p) => p.hunger), thirst: mean((p) => p.thirst) };
        for (let i = Math.round(young.length * 0.0002); i > 0; i--) young.push({ ...arrival, poorTicks: 0, wealth: 0, housed: true });
      }
    }
  }
  return {
    populations: cohorts.map((c) => c.length),
    health: cohorts.map((c) => c.reduce((s, p) => s + p.health, 0) / c.length),
    hunger: cohorts.map((c) => c.reduce((s, p) => s + p.hunger, 0) / c.length),
    money: cohorts.map((c) => c.reduce((s, p) => s + p.wealth, 0)),
    deaths,
    emigrated,
  };
}

function cohortModel(setup: Setup) {
  let cohorts: Cohort[] = setup.populations.map((n, c) => ({
    ...newCohort(`c${c}`, `Cohort ${c}`, BANDS[c]!, n, 50),
    houses: (n * setup.housing[c]!) / 1000,
    homelessness: 1 - setup.housing[c]!,
  }));
  const money = new Map(cohorts.map((c, i) => [c.id, MEAN_WEALTH[i]! * c.population]));
  for (let t = 0; t < setup.ticks; t++) {
    const grain = Object.fromEntries(cohorts.map((c, i) => [c.id, setup.foodMet[i]! * Math.floor(c.population * 0.01)]));
    const tick = runHouseholds(cohorts, grain, setup.water, (id) => money.get(id)!);
    cohorts = tick.cohorts;
    for (const t2 of tick.transfers) {
      money.set(t2.from, money.get(t2.from)! - t2.amount);
      money.set(t2.to, money.get(t2.to)! + t2.amount);
    }
  }
  return {
    populations: cohorts.map((c) => c.population),
    health: cohorts.map((c) => c.health),
    hunger: cohorts.map((c) => c.hunger),
    money: cohorts.map((c) => money.get(c.id)!),
    deaths: cohorts.reduce((s, c) => s + c.deaths, 0),
    emigrated: cohorts.reduce((s, c) => s + c.emigrated, 0),
  };
}

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1, Math.abs(b));

function compare(setup: Setup, seeds: number[]) {
  const cohort = cohortModel(setup);
  return seeds.map((seed) => ({ cohort, ref: reference(setup, seed) }));
}

const BASE: Setup = { populations: [30_000, 30_000, 30_000], housing: [1, 1, 1], foodMet: [1, 1, 1], water: 1, wealthSpread: 0.9, ticks: 60 };

describe("Household Cohorts match an individual-level reference", () => {
  it("fed, watered and housed: headcounts, welfare and money agree within 1%", { timeout: 30_000 }, () => {
    for (const { cohort, ref } of compare(BASE, [1, 2, 3])) {
      for (let c = 0; c < 3; c++) {
        expect(rel(cohort.populations[c]!, ref.populations[c]!)).toBeLessThan(0.01);
        expect(cohort.health[c]!).toBeCloseTo(ref.health[c]!, 0);
        // Wealth of ageing citizens is random in the reference, an average in the cohort model.
        expect(rel(cohort.money[c]!, ref.money[c]!)).toBeLessThan(0.01);
      }
      expect(ref.deaths).toBe(0);
      expect(cohort.deaths).toBe(0);
    }
  });

  it("in a famine (10% of grain): deaths, emigration, hunger and headcounts agree within 3%", { timeout: 30_000 }, () => {
    const famine: Setup = { ...BASE, foodMet: [0.1, 0.1, 0.1], ticks: 80 };
    const runs = compare(famine, [1, 2, 3, 4, 5]);
    for (const { cohort, ref } of runs) {
      expect(ref.deaths).toBeGreaterThan(1000);
      expect(rel(cohort.deaths, ref.deaths)).toBeLessThan(0.03);
      expect(rel(cohort.emigrated, ref.emigrated)).toBeLessThan(0.03);
      for (let c = 0; c < 3; c++) {
        expect(Math.abs(cohort.hunger[c]! - ref.hunger[c]!)).toBeLessThan(1);
        expect(Math.abs(cohort.health[c]! - ref.health[c]!)).toBeLessThan(2);
      }
    }
    // The few thousand survivors of a famine carry about 2% sampling noise per random seed in the reference,
    // so headcounts are compared on the mean of five seeds.
    for (let c = 0; c < 3; c++) {
      const mean = runs.reduce((s, r) => s + r.ref.populations[c]!, 0) / runs.length;
      expect(rel(runs[0]!.cohort.populations[c]!, mean)).toBeLessThan(0.03);
    }
  });

  it("a thirst shock (no water) kills at the same rate in both", { timeout: 30_000 }, () => {
    const dry: Setup = { ...BASE, water: 0, ticks: 70 };
    for (const { cohort, ref } of compare(dry, [4, 5])) {
      expect(ref.deaths).toBeGreaterThan(1000);
      expect(rel(cohort.deaths, ref.deaths)).toBeLessThan(0.03);
    }
  });

  it("conserves money across ageing exactly, in both models", () => {
    const { cohort } = compare(BASE, [1])[0]!;
    const start = MEAN_WEALTH.reduce((s, m) => s + m * 30_000, 0);
    expect(cohort.money.reduce((s, m) => s + m, 0)).toBe(start);
  });

  it("states the gap where the cohort mean hides heterogeneity: a half-housed cohort", () => {
    // Half the citizens are exposed (2 health per Tick) and half are not. The cohort model applies the
    // mean exposure to everyone, so nobody crosses the death threshold; individually the unhoused do.
    const half: Setup = { ...BASE, housing: [0.5, 0.5, 0.5], foodMet: [0.7, 0.7, 0.7], ticks: 40 };
    const { cohort, ref } = compare(half, [1])[0]!;
    const gap = rel(cohort.deaths, ref.deaths);
    // Documented, not tolerated: the models differ here and the reference sees more deaths.
    expect(ref.deaths).toBeGreaterThan(cohort.deaths);
    expect(gap).toBeGreaterThan(0.1);
  });
});
