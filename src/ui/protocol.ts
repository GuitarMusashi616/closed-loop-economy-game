import type { EducationView, Alert, LeverStages, TutorialStep, DebtBurdensView, GovernmentDebtView, DurablesView, ResearchView, Explanation, MoneyFlowView, TickStats, FiscalFlows, SectoralBalanceView, TaxRates, Citizen, CommercialBankView, Cohort, CohortView, Command, CountrySummary, IndustryView, MoneyEvent, ProductMarketView } from "../sim";

export type Speed = 0 | 1 | 2 | 4;

export type ToWorker =
  | { type: "command"; command: Command }
  | { type: "step" }
  | { type: "zoom"; cohortId: string }
  | { type: "setSpeed"; speed: Speed }
  /** Length in Ticks of the period the Sankey covers, or 0 for all time. */
  | { type: "setFlowWindow"; ticks: number }
  | { type: "save" }
  | { type: "load"; save: string };

export interface Snapshot {
  seed: number;
  tick: number;
  speed: Speed;
  moneySupply: number;
  holders: { holder: string; balance: number }[];
  log: MoneyEvent[];
  cohorts: Cohort[];
  households: CohortView[];
  summary: CountrySummary;
  industries: IndustryView[];
  products: ProductMarketView[];
  wageMarkup: number;
  bank: CommercialBankView;
  queued: Command[];
  fiscal: FiscalFlows & { rates: TaxRates };
  sectoral: SectoralBalanceView;
  education: EducationView;
  research: ResearchView;
  flowWindow: number;
  flows: MoneyFlowView;
  history: TickStats[];
  notes: Explanation[];
  stages: LeverStages;
  alerts: Alert[];
  tutorial: TutorialStep[];
  durables: DurablesView[];
  debt: GovernmentDebtView;
  burdens: DebtBurdensView;
  pensionRate: number;
  pensionsPaid: number;
}

export type FromWorker =
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "citizen"; citizen: Citizen }
  | { type: "saved"; save: string }
  | { type: "error"; message: string };
