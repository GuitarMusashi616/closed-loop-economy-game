import type { Cohort } from "./households";
import type { Industry } from "./industry";

/** A skill a Citizen builds by working. Each boosts productivity in two specific Industries. */
export type ExperienceType = "trades" | "professional" | "scientist";

/** The daily cost of living, which every wage must cover. */
export const COST_OF_LIVING = 8;
/** What schooling for each Experience Type costs, spread over the days a worker is expected to use it. */
const EDUCATION_COST: Record<ExperienceType, number> = { trades: 800, professional: 1600, scientist: 2400 };
const AMORTIZATION_DAYS = 400;

/** Share of the workers in a pool who can change job in one Tick (fractional daily flow). */
export const DAILY_FLOW = 0.1;
/** A worker only switches Industry for a wage at least this much higher (a fraction). */
export const SWITCH_MARGIN = 0.1;
/** Experience is 0 to 1; each day worked closes this share of the gap to 1, so returns diminish. */
export const EXPERIENCE_GROWTH = 0.01;
/** Share of experience lost per day unemployed. */
export const EXPERIENCE_DECAY = 0.02;
/** Share of experience in an Industry that carries over to the other Industry of the same Experience Type. */
export const TRANSFER = 0.5;
/** Productivity at full experience is 1 + this. */
export const MAX_BOOST = 1;
const WAGE_RISE = 0.03;
const WAGE_FALL = 0.02;
const WAGE_CEILING = 3;

/** The lowest wage an Industry starts from: cost of living plus amortized education. */
export function wageFloor(type: ExperienceType | null): number {
  return COST_OF_LIVING + (type ? Math.ceil(EDUCATION_COST[type] / AMORTIZATION_DAYS) : 0);
}

export const productivityOf = (type: ExperienceType | null, experience: number) =>
  type ? 1 + MAX_BOOST * experience : 1;

/** Experience of the unemployed as a whole, by the Industry it was earned in (a mean over the pool). */
export interface Labor {
  skills: Record<string, number>;
}

export const newLabor = (): Labor => ({ skills: {} });

export const isWorkingAge = (c: Cohort) => c.ageBand !== "retired";

interface Pool {
  count: number;
  skills: Record<string, number>;
  /** Flow still available this Tick. */
  budget: number;
}

function merge(into: Pool, count: number, skills: Record<string, number>) {
  if (count <= 0) return;
  const total = into.count + count;
  for (const key of new Set([...Object.keys(into.skills), ...Object.keys(skills)])) {
    into.skills[key] = ((into.skills[key] ?? 0) * into.count + (skills[key] ?? 0) * count) / total;
  }
  into.count = total;
}

/** The experience a pool's members bring to an Industry: their own, or part of a same-type Industry's. */
function skillFor(skills: Record<string, number>, target: Industry, all: Industry[]): number {
  if (!target.experienceType) return 0;
  const carried = all
    .filter((o) => o.id !== target.id && o.experienceType === target.experienceType)
    .reduce((m, o) => Math.max(m, TRANSFER * (skills[o.id] ?? 0)), 0);
  return Math.max(skills[target.id] ?? 0, carried);
}

/**
 * The labor market for one Tick: job matching as a flow between pools of workers (the unemployed
 * and the employees of each Industry), then wages adjust to whether jobs could be filled.
 * `demand` is how many workers each Industry wants. `floorScale` (at most 1) lowers the wage floor and ceiling
 * when prices have fallen, so wages can follow them down.
 */
export function runLabor(
  industries: Industry[],
  cohorts: Cohort[],
  labor: Labor,
  demand: (industry: Industry) => number,
  floorScale = 1,
): { industries: Industry[]; labor: Labor } {
  const force = cohorts.filter(isWorkingAge).reduce((s, c) => s + c.population, 0);
  const wanted = new Map(industries.map((i) => [i.id, i.started && !i.failed ? Math.max(0, demand(i)) : 0]));

  // Deaths and emigration shrink the workforce; if it falls below the jobs held, every pool shrinks in step.
  const held = industries.reduce((s, i) => s + i.workers, 0);
  const shrink = held > force ? force / held : 1;
  const pools = new Map<string, Pool>();
  for (const i of industries) pools.set(i.id, { count: i.workers * shrink, skills: { ...i.skills }, budget: 0 });
  const jobless: Pool = { count: Math.max(0, force - held * shrink), skills: { ...labor.skills }, budget: 0 };

  // Layoffs: workers beyond what an Industry wants (all of them once it fails) join the unemployed.
  for (const i of industries) {
    const pool = pools.get(i.id)!;
    const surplus = pool.count - wanted.get(i.id)!;
    if (surplus > 1e-9) {
      merge(jobless, surplus, pool.skills);
      pool.count -= surplus;
    }
  }
  jobless.budget = DAILY_FLOW * jobless.count;
  for (const pool of pools.values()) pool.budget = DAILY_FLOW * pool.count;

  // Hiring: the best-paying Industries pick first. Each takes candidates ranked by productivity, drawn
  // from the unemployed and from Industries that pay less by more than the switching margin.
  const byWage = [...industries].sort((a, b) => b.wage - a.wage);
  for (const industry of byWage) {
    const pool = pools.get(industry.id)!;
    let vacancies = wanted.get(industry.id)! - pool.count;
    if (vacancies <= 1e-9) continue;
    const candidates = [jobless, ...industries.filter((o) => o.id !== industry.id && o.wage * (1 + SWITCH_MARGIN) <= industry.wage).map((o) => pools.get(o.id)!)]
      .map((source) => ({ source, skill: skillFor(source.skills, industry, industries) }))
      .sort((a, b) => b.skill - a.skill);
    for (const { source, skill } of candidates) {
      const moved = Math.min(vacancies, source.budget, source.count);
      if (moved <= 1e-9) continue;
      source.count -= moved;
      source.budget -= moved;
      vacancies -= moved;
      merge(pool, moved, { ...source.skills, [industry.id]: skill });
    }
  }

  const next = industries.map((i): Industry => {
    const pool = pools.get(i.id)!;
    const want = wanted.get(i.id)!;
    const floor = Math.max(1, Math.round(wageFloor(i.experienceType) * floorScale));
    let wage = i.wage;
    if (want > 0 && pool.count < want - 1e-9) wage = Math.min(floor * WAGE_CEILING, wage + Math.max(1, Math.ceil(wage * WAGE_RISE)));
    else if (want > 0) wage = Math.max(floor, wage - Math.max(1, Math.floor(wage * WAGE_FALL)));
    return { ...i, workers: pool.count, skills: pool.skills, wage, productivity: productivityOf(i.experienceType, pool.skills[i.id] ?? 0) };
  });

  // The unemployed lose experience for every day without work.
  const skills = Object.fromEntries(Object.entries(jobless.skills).map(([k, v]) => [k, v * (1 - EXPERIENCE_DECAY)]));
  return { industries: next, labor: { skills } };
}

/** Workers gain experience in their Industry for every day they work, with diminishing returns. */
export function developSkills(industry: Industry): Industry {
  if (!industry.experienceType || industry.headcount <= 0 || industry.workers <= 0) return industry;
  const share = Math.min(1, industry.headcount / industry.workers);
  const current = industry.skills[industry.id] ?? 0;
  const grown = current + EXPERIENCE_GROWTH * share * (1 - current);
  return { ...industry, skills: { ...industry.skills, [industry.id]: grown }, productivity: productivityOf(industry.experienceType, grown) };
}
