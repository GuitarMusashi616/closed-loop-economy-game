import type { CommercialBankView, Cohort, Command, IndustryView, MoneyEvent } from "../sim";

export type Speed = 0 | 1 | 2 | 4;

export type ToWorker =
  | { type: "command"; command: Command }
  | { type: "step" }
  | { type: "setSpeed"; speed: Speed }
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
  industries: IndustryView[];
  bank: CommercialBankView;
  queued: Command[];
}

export type FromWorker =
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "saved"; save: string }
  | { type: "error"; message: string };
