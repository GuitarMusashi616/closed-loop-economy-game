import { seededRandom } from "./rng";
import { homelessShare } from "./housing";

export type AgeBand = "young" | "established" | "retired";

/** A Household Cohort: citizens sharing a state (here an age band), simulated as one unit. */
export interface Cohort {
  id: string;
  name: string;
  ageBand: AgeBand;
  population: number;
  // Welfare Stats. Health, hunger, thirst and education are per-citizen means on a 0-100 scale
  // (hunger and thirst: higher is worse). Homelessness is the fraction of citizens without
  // housing, held at 0 until housing exists. Wealth comes from the ledger, see CohortView.
  health: number;
  hunger: number;
  thirst: number;
  homelessness: number;
  education: number;
  /** Consecutive Ticks of poor welfare, which drive emigration. */
  poorTicks: number;
  /** Lifetime totals, for the country summary. */
  deaths: number;
  emigrated: number;
  /** Consecutive Ticks the cohort has missed a Retail Credit payment. */
  missedPayments: number;
  /** Citizens studying this Tick, who are out of the workforce. */
  students: number;
  /** Owned durables: houses shelter a block of citizens each (homelessness follows from them). */
  houses: number;
  cars: number;
  /** Consecutive Ticks the cohort has missed a Collateralised Loan payment. */
  securedMissed: number;
  /** Lifetime births. */
  births: number;
  /** Lifetime immigrants, who only ever arrive in the youngest cohort. Absent in older saves. */
  immigrated: number;
}

export interface CohortView extends Cohort {
  money: number;
  /** Money per citizen. */
  wealth: number;
}

export interface Citizen {
  cohortId: string;
  index: number;
  health: number;
  hunger: number;
  thirst: number;
  homeless: boolean;
  education: number;
  wealth: number;
}

export interface CountrySummary {
  population: number;
  health: number;
  hunger: number;
  thirst: number;
  homelessness: number;
  education: number;
  wealth: number;
  deaths: number;
  emigrated: number;
  immigrated: number;
}

/** Units of grain a cohort wants per day, per head. */
export const GRAIN_NEED_PER_HEAD = 0.01;

const HUNGER_RISE = 8;
const HUNGER_FALL = 25;
const STRAIN_THRESHOLD = 30;
const STRAIN_DAMAGE = 0.05;
const RECOVERY = 1;
const DEATH_HEALTH = 60;
const DEATH_RATE = 0.03;
const POOR_HEALTH = 50;
const POOR_NEED = 70;
const EMIGRATION_AFTER = 7;
const EMIGRATION_RATE = 0.01;
const AGING_RATE = 0.0005;
const BIRTH_RATE = 0.0003;
/** Share of the youngest cohort that arrives from abroad each Tick while welfare there is decent: low immigration. */
const IMMIGRATION_RATE = 0.0002;
/** Newcomers only come to a cohort that is healthy, fed, watered and housed at least this well. */
const IMMIGRATION_MIN_HEALTH = 70;
const IMMIGRATION_MAX_NEED = 20;
const IMMIGRATION_MAX_HOMELESSNESS = 0.05;
/** Health lost per Tick by a cohort whose citizens are all unhoused. */
const EXPOSURE_DAMAGE = 2;

/** Births fall off once hunger passes the strain threshold, and stop at 100. */
const foodSecurity = (hunger: number) => 1 - Math.max(0, hunger - STRAIN_THRESHOLD) / (100 - STRAIN_THRESHOLD);

const clamp = (value: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, value));

export function newCohort(id: string, name: string, ageBand: AgeBand, population: number, education: number): Cohort {
  return {
    id, name, ageBand, population,
    health: 90, hunger: 0, thirst: 0, homelessness: 0, education,
    poorTicks: 0, deaths: 0, emigrated: 0, missedPayments: 0, students: 0,
    houses: 0, cars: 0, securedMissed: 0, births: 0, immigrated: 0,
  };
}

export function hasWelfareStats(cohorts: Cohort[]): boolean {
  return cohorts.every((c) => typeof c.health === "number" && typeof c.poorTicks === "number" && typeof c.students === "number");
}

export function hasDurables(cohorts: Cohort[]): boolean {
  return cohorts.every((c) => typeof c.houses === "number" && typeof c.births === "number");
}

/** A need level moves towards 0 as it is met and towards 100 as it is missing. */
function needLevel(level: number, met: number): number {
  return clamp(level + HUNGER_RISE * (1 - met) - HUNGER_FALL * met);
}

function mix(a: number, an: number, b: number, bn: number): number {
  return an + bn === 0 ? 0 : (a * an + b * bn) / (an + bn);
}

/** Moves `count` newcomers with the given stats into a cohort, averaging their stats in. */
function admit(c: Cohort, count: number, stats: Pick<Cohort, "health" | "hunger" | "thirst" | "homelessness" | "education">): Cohort {
  return {
    ...c,
    population: c.population + count,
    health: mix(c.health, c.population, stats.health, count),
    hunger: mix(c.hunger, c.population, stats.hunger, count),
    thirst: mix(c.thirst, c.population, stats.thirst, count),
    homelessness: mix(c.homelessness, c.population, stats.homelessness, count),
    education: mix(c.education, c.population, stats.education, count),
  };
}

export interface HouseholdTick {
  cohorts: Cohort[];
  /** Money that travels with citizens who changed cohort. */
  transfers: { from: string; to: string; amount: number }[];
}

/**
 * One Tick of the Household Cohorts: food and water move hunger and thirst, deprivation lowers
 * health and kills, sustained poor welfare causes emigration, then citizens age into the next
 * cohort. `grain` is the units each cohort bought this Tick.
 */
export function runHouseholds(
  cohorts: Cohort[],
  grain: Record<string, number>,
  waterCoverage: number,
  money: (cohortId: string) => number,
): HouseholdTick {
  let next = cohorts.map((c): Cohort => {
    const need = Math.floor(c.population * GRAIN_NEED_PER_HEAD);
    const foodMet = need === 0 ? 1 : Math.min(1, (grain[c.id] ?? 0) / need);
    const hunger = needLevel(c.hunger, foodMet);
    const thirst = needLevel(c.thirst, waterCoverage);
    const strain = Math.max(hunger, thirst);
    // Citizens without a house suffer exposure on top of any hunger or thirst.
    const health = clamp(
      (strain >= STRAIN_THRESHOLD ? c.health - STRAIN_DAMAGE * strain : c.health + RECOVERY) - EXPOSURE_DAMAGE * c.homelessness,
    );

    const poor = health < POOR_HEALTH || hunger > POOR_NEED || thirst > POOR_NEED;
    const poorTicks = poor ? c.poorTicks + 1 : 0;

    const deaths = health < DEATH_HEALTH ? Math.min(c.population, Math.floor((c.population * (DEATH_HEALTH - health) * DEATH_RATE) / DEATH_HEALTH)) : 0;
    const afterDeaths = c.population - deaths;
    const emigrants = poorTicks >= EMIGRATION_AFTER ? Math.min(afterDeaths, Math.ceil(afterDeaths * EMIGRATION_RATE)) : 0;

    return {
      ...c, health, hunger, thirst, poorTicks,
      population: afterDeaths - emigrants,
      deaths: c.deaths + deaths,
      emigrated: c.emigrated + emigrants,
    };
  });

  // Ageing: a small share of each band moves into the next, bringing its stats and money along.
  const transfers: HouseholdTick["transfers"] = [];
  const moving = next.map((c, i) => (i < next.length - 1 ? Math.round(c.population * AGING_RATE) : 0));
  const before = next;
  next = next.map((c, i) => {
    let out = c;
    if (moving[i]! > 0) out = { ...out, population: out.population - moving[i]! };
    const arriving = i > 0 ? moving[i - 1]! : 0;
    return arriving > 0 ? admit(out, arriving, before[i - 1]!) : out;
  });
  // Births join the youngest cohort, healthy and without schooling. They need housing and food security.
  const young = next[0];
  const births =
    young && young.health >= DEATH_HEALTH
      ? Math.round(young.population * BIRTH_RATE * (1 - young.homelessness) * foodSecurity(young.hunger))
      : 0;
  if (young && births > 0) next[0] = { ...admit(young, births, { health: 100, hunger: 0, thirst: 0, homelessness: 0, education: 0 }), births: young.births + births };
  // Low immigration: where welfare is decent a few newcomers arrive, with the cohort's own stats, so the mix is unchanged.
  const arrivals = next[0];
  if (arrivals && arrivals.health >= IMMIGRATION_MIN_HEALTH && arrivals.hunger <= IMMIGRATION_MAX_NEED && arrivals.thirst <= IMMIGRATION_MAX_NEED && homelessShare(arrivals.houses, arrivals.population) <= IMMIGRATION_MAX_HOMELESSNESS) {
    const immigrants = Math.round(arrivals.population * IMMIGRATION_RATE);
    if (immigrants > 0) next[0] = { ...admit(arrivals, immigrants, arrivals), immigrated: (arrivals.immigrated ?? 0) + immigrants };
  }
  // Housing is fixed by the houses owned, so homelessness follows population.
  next = next.map((c) => ({ ...c, homelessness: homelessShare(c.houses, c.population) }));
  for (let i = 0; i < before.length - 1; i++) {
    if (moving[i]! === 0 || before[i]!.population === 0) continue;
    const amount = Math.floor((money(before[i]!.id) * moving[i]!) / before[i]!.population);
    if (amount > 0) transfers.push({ from: before[i]!.id, to: before[i + 1]!.id, amount });
  }
  return { cohorts: next, transfers };
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

const STATS = ["health", "hunger", "thirst", "education", "wealth", "homeless"] as const;

/**
 * A Citizen of a cohort, chosen by `slot`. Each stat is the cohort mean plus an offset taken from
 * a permutation of evenly spaced quantiles, so the offsets across all citizens cancel exactly and
 * the cohort's totals are preserved.
 */
export function sampleCitizenOf(cohort: CohortView, seed: number, slot: number): Citizen {
  const n = cohort.population;
  if (n <= 0) throw new Error(`Household Cohort ${cohort.id} has no citizens`);
  const index = ((Math.trunc(slot) % n) + n) % n;
  let stride = Math.max(1, Math.floor(n * 0.618));
  while (gcd(stride, n) !== 1) stride++;
  const cohortSalt = [...cohort.id].reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const rank = (stat: (typeof STATS)[number]) => {
    const shift = Math.floor(seededRandom(seed + cohortSalt + STATS.indexOf(stat) * 1013)() * n);
    return (index * stride + shift) % n;
  };
  const around = (stat: (typeof STATS)[number], mean: number, spread: number) => {
    const s = Math.min(spread, mean, 100 - mean);
    return mean + ((rank(stat) - (n - 1) / 2) / n) * 2 * Math.max(0, s);
  };
  return {
    cohortId: cohort.id,
    index,
    health: around("health", cohort.health, 15),
    hunger: around("hunger", cohort.hunger, 15),
    thirst: around("thirst", cohort.thirst, 15),
    education: around("education", cohort.education, 20),
    wealth: cohort.wealth + ((rank("wealth") - (n - 1) / 2) / n) * 2 * cohort.wealth * 0.8,
    homeless: rank("homeless") < Math.round(cohort.homelessness * n),
  };
}
