import { bankView } from "./bank";
import type { Ledger } from "./ledger";

/** Levers unlock in stages: basics (spending, loans, Monetization), then taxes (with debt, pensions and Markups), then the Policy Rate. */
export type LeverStage = "basics" | "taxes" | "policyRate";
export type LeverStages = Record<LeverStage, boolean>;

/** The Tick on which each stage opens in a gradual-unlock world. */
export const UNLOCK_TICK: Record<LeverStage, number> = { basics: 0, taxes: 10, policyRate: 40 };

const STAGE_OF_COMMAND: Record<string, LeverStage> = {
  monetize: "basics",
  grant: "basics",
  industryLoan: "basics",
  convertLoan: "basics",
  setResearch: "basics",
  setTaxRates: "taxes",
  setMarkup: "taxes",
  issueDebt: "taxes",
  retireDebt: "taxes",
  setPensionRate: "taxes",
  setPolicyRate: "policyRate",
  setSpreads: "policyRate",
};

export function stagesAt(tick: number, gradual: boolean): LeverStages {
  const open = (stage: LeverStage) => !gradual || tick >= UNLOCK_TICK[stage];
  return { basics: open("basics"), taxes: open("taxes"), policyRate: open("policyRate") };
}

export function assertUnlocked(commandType: string, tick: number, gradual: boolean): void {
  const stage = STAGE_OF_COMMAND[commandType];
  if (stage && !stagesAt(tick, gradual)[stage]) {
    throw new Error(`${commandType} is locked until Day ${UNLOCK_TICK[stage]}`);
  }
}

export interface Alert {
  id: "famine" | "banksHaltLending" | "massLayoffs";
  message: string;
}

/** Mean hunger (0 to 100) at which the country is in famine. */
export const FAMINE_HUNGER = 60;
/** Share of the workforce lost in one Tick that counts as mass layoffs. */
export const MASS_LAYOFF_SHARE = 0.2;

export function alertsFor(input: { hunger: number; ledger: Ledger; employment: number[] }): Alert[] {
  const found: Alert[] = [];
  if (input.hunger >= FAMINE_HUNGER) {
    found.push({ id: "famine", message: `Famine: citizens are starving (mean hunger ${input.hunger.toFixed(0)}). Get food bought and produced.` });
  }
  if (!bankView(input.ledger, { policyRate: 0, retailSpread: 0, collateralisedSpread: 0 }).lending) {
    found.push({ id: "banksHaltLending", message: "The Commercial Bank has halted lending: it has too little equity for new loans." });
  }
  const [prev, last] = input.employment.slice(-2);
  if (prev !== undefined && last !== undefined && prev > 0 && (prev - last) / prev >= MASS_LAYOFF_SHARE) {
    found.push({ id: "massLayoffs", message: `Mass layoffs: employment fell from ${prev.toLocaleString()} to ${last.toLocaleString()} in one Day.` });
  }
  return found;
}

export interface TutorialStep {
  id: "monetize" | "industryLoan" | "grant" | "run";
  text: string;
  done: boolean;
}

/** The first-run steps, ticked off from the causes of money movements so far. */
export function tutorialFor(causes: Set<string>, tick: number): TutorialStep[] {
  const steps: Omit<TutorialStep, "done">[] = [
    { id: "monetize", text: "The economy starts with no money. Monetize: the Central Bank buys debt from the Treasury and creates the first money." },
    { id: "industryLoan", text: "Make an Industry Loan to Agriculture so it can start paying wages and growing grain." },
    { id: "grant", text: "Give a Grant to a Household Cohort so citizens have money to buy food." },
    { id: "run", text: "Press 1x to run a few Days and watch the money flow, then check Citizens for hunger." },
  ];
  const done = [causes.has("Monetization"), causes.has("Industry Loan"), causes.has("Grant"), tick >= 5];
  return steps.map((s, i) => ({ ...s, done: done[i] ?? false }));
}
