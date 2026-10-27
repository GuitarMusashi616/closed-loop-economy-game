import { hasWelfareStats, newCohort, runHouseholds, sampleCitizenOf, type Citizen, type Cohort, type CohortView, type CountrySummary } from "./households";
import { seededRandom } from "./rng";
import { industryAccounts, newAgriculture, runIndustry, stockOf, type Industry, type IndustryView, type ProductLine } from "./industry";
import { PRODUCTS, driftTastes, neutralTastes, type Tastes, type Tier } from "./products";
import { BANK_ACCOUNTS, FOUNDING_BALANCES, bankView, newPolicy, runRetailCredit, type BankPolicy, type CommercialBankView } from "./bank";
import { checkInvariants, emptyLedger, ledgerMoneySupply, post, type Account, type Ledger, type MoneyEvent, type Transaction } from "./ledger";

export type { MoneyEvent } from "./ledger";
export { InvariantViolation } from "./ledger";
export type { IndustryView, ProductLine } from "./industry";
export type { Tastes, Tier } from "./products";
export type { BankPolicy, CommercialBankView } from "./bank";

export type Command =
  | { type: "monetize"; amount: number }
  | { type: "grant"; cohortId: string; amount: number }
  | { type: "industryLoan"; industryId: string; amount: number }
  | { type: "setPolicyRate"; rate: number }
  | { type: "setSpreads"; retail?: number; collateralised?: number }
  /** A Markup / Discount in percent on a Product id or on "wages", applied after discovery. 0 clears it. */
  | { type: "setMarkup"; target: string; percent: number };

export type { AgeBand, Citizen, Cohort, CohortView, CountrySummary } from "./households";

export interface World {
  seed: number;
  tick: number;
  cohorts: Cohort[];
  /** Share of every cohort's water need that the public supply meets, 0 to 1. */
  waterCoverage: number;
  industries: Industry[];
  policy: BankPolicy;
  /** Cohort taste multipliers per Product, which drift each Tick. */
  tastes: Tastes;
  /** Player Markup / Discount in percent, by Product id or "wages". Absent means 0%. */
  markups: Record<string, number>;
  ledger: Ledger;
  log: MoneyEvent[];
}

const TREASURY = "Treasury";

const ACCOUNTS: Account[] = [
  { id: "centralBank:moneyIssued", kind: "liability", holder: "Central Bank", isMoney: false },
  { id: "centralBank:govDebtHeld", kind: "asset", holder: "Central Bank", isMoney: false },
  { id: "treasury:money", kind: "asset", holder: TREASURY, isMoney: true },
  { id: "treasury:debtOwed", kind: "liability", holder: TREASURY, isMoney: false },
  { id: "treasury:loansReceivable", kind: "asset", holder: TREASURY, isMoney: false },
];

function accountsFor(industry: Industry): Account[] {
  const acct = industryAccounts(industry);
  return [
    { id: acct.money, kind: "asset", holder: industry.name, isMoney: true },
    { id: acct.loanOwed, kind: "liability", holder: industry.name, isMoney: false },
    { id: acct.equity, kind: "equity", holder: industry.name, isMoney: false },
  ];
}

const COHORTS = [
  { name: "Young Workers", ageBand: "young", education: 40 },
  { name: "Established Families", ageBand: "established", education: 60 },
  { name: "Retirees", ageBand: "retired", education: 50 },
] as const;

export function createWorld(seed: number, options: { waterCoverage?: number } = {}): World {
  const random = seededRandom(seed);
  const cohorts = COHORTS.map((c, i) =>
    newCohort(`cohort-${i}`, c.name, c.ageBand, 20000 + Math.floor(random() * 20000), c.education),
  );
  const cohortAccounts = cohorts.flatMap((c): Account[] => [
    { id: `${c.id}:money`, kind: "asset", holder: c.name, isMoney: true },
    { id: `${c.id}:equity`, kind: "equity", holder: c.name, isMoney: false },
    { id: `${c.id}:loanOwed`, kind: "liability", holder: c.name, isMoney: false },
  ]);
  const industries = [newAgriculture()];
  return {
    seed,
    tick: 0,
    cohorts,
    waterCoverage: options.waterCoverage ?? 1,
    industries,
    policy: newPolicy(),
    tastes: neutralTastes(cohorts.map((c) => c.id)),
    markups: {},
    ledger: withFounding(emptyLedger([
      ...ACCOUNTS,
      ...BANK_ACCOUNTS,
      { id: "treasury:equity", kind: "equity", holder: TREASURY, isMoney: false },
      ...cohortAccounts,
      ...industries.flatMap(accountsFor),
    ])),
    log: [],
  };
}

function withFounding(ledger: Ledger): Ledger {
  return { ...ledger, balances: { ...ledger.balances, ...FOUNDING_BALANCES } };
}

export function commercialBank(world: World): CommercialBankView {
  return bankView(world.ledger, world.policy);
}

export function cohorts(world: World): Cohort[] {
  return world.cohorts;
}

export function cohortViews(world: World): CohortView[] {
  return world.cohorts.map((c) => {
    const money = world.ledger.balances[`${c.id}:money`] ?? 0;
    return { ...c, money, wealth: c.population > 0 ? money / c.population : 0 };
  });
}

export function countrySummary(world: World): CountrySummary {
  const views = cohortViews(world);
  const population = views.reduce((s, c) => s + c.population, 0);
  const mean = (pick: (c: CohortView) => number) =>
    population === 0 ? 0 : views.reduce((s, c) => s + pick(c) * c.population, 0) / population;
  return {
    population,
    health: mean((c) => c.health),
    hunger: mean((c) => c.hunger),
    thirst: mean((c) => c.thirst),
    homelessness: mean((c) => c.homelessness),
    education: mean((c) => c.education),
    wealth: mean((c) => c.wealth),
    deaths: views.reduce((s, c) => s + c.deaths, 0),
    emigrated: views.reduce((s, c) => s + c.emigrated, 0),
  };
}

/** The Citizen at `slot` in a cohort, chosen deterministically and consistent with the cohort's totals. */
export function sampleCitizen(world: World, cohortId: string, slot: number): Citizen {
  const cohort = cohortViews(world).find((c) => c.id === cohortId);
  if (!cohort) throw new Error(`Unknown Household Cohort ${cohortId}`);
  return sampleCitizenOf(cohort, world.seed, slot);
}

export function industries(world: World): IndustryView[] {
  return world.industries.map((industry) => {
    const acct = industryAccounts(industry);
    const { balances } = world.ledger;
    return {
      ...industry,
      money: balances[acct.money] ?? 0,
      loanOwed: balances[acct.loanOwed] ?? 0,
      equity: balances[acct.equity] ?? 0,
    };
  });
}

export interface ProductMarketView {
  id: string;
  name: string;
  tier: Tier;
  /** Units that were for sale this Tick across all Industries, before sales. */
  supply: number;
  /** Units cohorts wanted at the clearing price. */
  demand: number;
  produced: number;
  sold: number;
  spoiled: number;
  /** Units still in stock. */
  stock: number;
  /** Latest price paid, after Markup / Discount, or 0 if never sold. */
  price: number;
  /** The player's Markup / Discount in percent. */
  markup: number;
}

/** Supply and demand for every Product, for inspection. */
export function productMarkets(world: World): ProductMarketView[] {
  return PRODUCTS.map((def) => {
    const lines = world.industries.flatMap((i) => i.lines.filter((l): l is ProductLine => l.productId === def.id));
    const sum = (pick: (l: ProductLine) => number) => lines.reduce((s, l) => s + pick(l), 0);
    const sold = sum((l) => l.sold);
    const priced = lines.filter((l) => l.price > 0);
    return {
      id: def.id,
      name: def.name,
      tier: def.tier,
      supply: sum((l) => stockOf(l)) + sold,
      demand: sum((l) => l.demand),
      produced: sum((l) => l.produced),
      sold,
      spoiled: sum((l) => l.spoiled),
      stock: sum((l) => stockOf(l)),
      price: priced.length > 0 ? Math.max(...priced.map((l) => l.price)) : 0,
      markup: world.markups[def.id] ?? 0,
    };
  });
}

export function moneySupply(world: World): number {
  return ledgerMoneySupply(world.ledger);
}

export function moneyHolders(world: World): { holder: string; balance: number }[] {
  const totals = new Map<string, number>();
  for (const account of world.ledger.accounts.filter((a) => a.isMoney)) {
    totals.set(account.holder, (totals.get(account.holder) ?? 0) + (world.ledger.balances[account.id] ?? 0));
  }
  return [...totals].map(([holder, balance]) => ({ holder, balance }));
}

export function moneyLog(world: World): MoneyEvent[] {
  return world.log;
}

export function serialize(world: World): string {
  return JSON.stringify(world);
}

/** Restores a saved world, throwing if its ledger fails the invariants. */
export function deserialize(save: string): World {
  const world = JSON.parse(save) as World;
  if (!Array.isArray(world.industries)) throw new Error("Save predates Industries and cannot be loaded");
  if (!world.policy) throw new Error("Save predates the Commercial Bank and cannot be loaded");
  if (!world.markups || !world.tastes || world.industries.some((i) => !Array.isArray(i.lines))) {
    throw new Error("Save predates the Full Product market and cannot be loaded");
  }
  if (!hasWelfareStats(world.cohorts) || typeof world.waterCoverage !== "number") {
    throw new Error("Save predates Welfare Stats and cannot be loaded");
  }
  checkInvariants(world.ledger);
  return world;
}

export function step(world: World, commands: Command[]): { world: World; events: MoneyEvent[] } {
  let ledger = world.ledger;
  let started = world.industries;
  let policy = world.policy;
  let markups = world.markups;
  const events: MoneyEvent[] = [];
  const grain: Record<string, number> = {};
  for (const command of commands) {
    if (command.type === "setPolicyRate" || command.type === "setSpreads") {
      policy = applyPolicy(policy, command);
      continue;
    }
    if (command.type === "setMarkup") {
      markups = applyMarkupCommand(markups, command);
      continue;
    }
    const result = post(ledger, toTransaction(world, command), world.tick);
    ledger = result.ledger;
    if (result.event) events.push(result.event);
    if (command.type === "industryLoan") {
      started = started.map((i) => (i.id === command.industryId ? { ...i, started: true } : i));
    }
  }
  const credit = runRetailCredit(ledger, world.cohorts, started, policy, world.tick);
  ledger = credit.ledger;
  events.push(...credit.events);
  const cohortsNext = credit.cohorts;
  const tastes = driftTastes(world.tastes, world.seed, world.tick);
  const next = started.map((industry) => {
    const run = runIndustry(industry, ledger, { cohorts: cohortsNext, tastes, markups }, world.tick);
    ledger = run.ledger;
    events.push(...run.events);
    for (const [id, units] of Object.entries(run.fills)) grain[id] = (grain[id] ?? 0) + units;
    return run.industry;
  });
  const households = runHouseholds(cohortsNext, grain, world.waterCoverage, (id) => ledger.balances[`${id}:money`] ?? 0);
  for (const t of households.transfers) {
    ledger = post(
      ledger,
      {
        type: "ageing",
        entries: [
          { account: `${t.from}:equity`, debit: t.amount },
          { account: `${t.from}:money`, credit: t.amount },
          { account: `${t.to}:money`, debit: t.amount },
          { account: `${t.to}:equity`, credit: t.amount },
        ],
      },
      world.tick,
    ).ledger;
  }
  checkInvariants(ledger);
  return { world: { ...world, tick: world.tick + 1, cohorts: households.cohorts, industries: next, policy, tastes, markups, ledger, log: [...world.log, ...events] }, events };
}

function applyMarkupCommand(markups: Record<string, number>, command: Extract<Command, { type: "setMarkup" }>): Record<string, number> {
  if (command.target !== "wages" && !PRODUCTS.some((p) => p.id === command.target)) {
    throw new Error(`Unknown Markup target ${command.target}`);
  }
  if (!Number.isFinite(command.percent) || command.percent <= -100) {
    throw new Error(`Markup / Discount must be a number above -100%, got ${command.percent}`);
  }
  return { ...markups, [command.target]: command.percent };
}

function applyPolicy(policy: BankPolicy, command: Extract<Command, { type: "setPolicyRate" | "setSpreads" }>): BankPolicy {
  const check = (name: string, value: number) => {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number, got ${value}`);
    return value;
  };
  if (command.type === "setPolicyRate") return { ...policy, policyRate: check("Policy rate", command.rate) };
  return {
    ...policy,
    retailSpread: command.retail === undefined ? policy.retailSpread : check("Retail spread", command.retail),
    collateralisedSpread:
      command.collateralised === undefined ? policy.collateralisedSpread : check("Collateralised spread", command.collateralised),
  };
}

function toTransaction(world: World, command: Exclude<Command, { type: "setPolicyRate" | "setSpreads" | "setMarkup" }>): Transaction {
  if (!Number.isSafeInteger(command.amount) || command.amount <= 0) {
    throw new Error(`${command.type} amount must be a positive whole number, got ${command.amount}`);
  }
  switch (command.type) {
    case "monetize":
      return {
        type: "monetization",
        entries: [
          { account: "treasury:money", debit: command.amount },
          { account: "treasury:debtOwed", credit: command.amount },
          { account: "centralBank:govDebtHeld", debit: command.amount },
          { account: "centralBank:moneyIssued", credit: command.amount },
        ],
      };
    case "industryLoan": {
      const industry = world.industries.find((i) => i.id === command.industryId);
      if (!industry) throw new Error(`Unknown Industry ${command.industryId}`);
      const acct = industryAccounts(industry);
      return {
        type: "industryLoan",
        entries: [
          { account: "treasury:loansReceivable", debit: command.amount },
          { account: "treasury:money", credit: command.amount },
          { account: acct.money, debit: command.amount },
          { account: acct.loanOwed, credit: command.amount },
        ],
      };
    }
    case "grant": {
      if (!world.cohorts.some((c) => c.id === command.cohortId)) {
        throw new Error(`Unknown Household Cohort ${command.cohortId}`);
      }
      return {
        type: "grant",
        entries: [
          { account: "treasury:equity", debit: command.amount },
          { account: "treasury:money", credit: command.amount },
          { account: `${command.cohortId}:money`, debit: command.amount },
          { account: `${command.cohortId}:equity`, credit: command.amount },
        ],
      };
    }
  }
}
