import { gdp, priceIndex, alerts, education, debtBurdens, durables, governmentDebt, leverStages, tutorial, research, explanations, history, moneyFlows, fiscal, sectoralBalance, cohortViews, cohorts, commercialBank, countrySummary, industries, moneyHolders, productMarkets, moneyLog, moneySupply, type Command, type World } from "../sim";
import type { Snapshot, Speed } from "./protocol";

/** The charts show the latest this-many Ticks, and the event list the latest notes, so a long game does not make every snapshot bigger. */
export const CHART_TICKS = 600;
export const NOTES_SHOWN = 100;

/** What the UI is shown after a Tick. Everything in it crosses the Worker boundary by structured clone, so its size is the per-Tick cost on the UI thread. */
export function buildSnapshot(world: World, speed: Speed, queued: Command[], flowWindow: number): Snapshot {
  return {
    seed: world.seed,
    tick: world.tick,
    speed,
    moneySupply: moneySupply(world),
    gdp: gdp(world),
    priceIndex: priceIndex(world),
    holders: moneyHolders(world),
    log: moneyLog(world),
    cohorts: cohorts(world),
    households: cohortViews(world),
    summary: countrySummary(world),
    industries: industries(world),
    products: productMarkets(world),
    wageMarkup: world.markups.wages ?? 0,
    bank: commercialBank(world),
    queued,
    fiscal: fiscal(world),
    sectoral: sectoralBalance(world),
    education: education(world),
    research: research(world),
    flowWindow,
    flows: moneyFlows(world, flowWindow === 0 ? 0 : Math.max(0, world.tick - flowWindow), world.tick),
    history: history(world).slice(-CHART_TICKS),
    notes: explanations(world).slice(-NOTES_SHOWN),
    stages: leverStages(world),
    alerts: alerts(world),
    tutorial: tutorial(world),
    durables: durables(world),
    debt: governmentDebt(world),
    burdens: debtBurdens(world),
    pensionRate: world.pensionRate,
    pensionsPaid: world.pensionsPaid,
  };
}
