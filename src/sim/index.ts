import { hasDurables, hasWelfareStats, newCohort, runHouseholds, sampleCitizenOf, type Citizen, type Cohort, type CohortView, type CountrySummary } from "./households";
import { runSupplyWeb } from "./web";
import { seededRandom } from "./rng";
import { isWorkingAge, newLabor, runLabor, workforceOf, type Labor } from "./labor";
import { checkShare, educationAccounts, educationLedgerAccounts, fundHealthcare, governmentTuitionRate, newEducationPolicy, runEducation, tuitionRate, type EducationPolicy, type PublicService } from "./education";
import { industryAccounts, labourDemand, newIndustries, runIndustry, startIndustry, stockOf, type Industry, type IndustryView, type ProductLine } from "./industry";
import { PRODUCTS, driftTastes, neutralTastes, type Tastes, type Tier } from "./products";
import { BANK_ACCOUNTS, FOUNDING_BALANCES, bankView, newPolicy, runRetailCredit, type BankPolicy, type CommercialBankView } from "./bank";
import { NO_FLOWS, checkRate, payTaxAndDividends, stakeAccount, type FiscalFlows, type TaxRates } from "./tax";
import { chooseActive, contractDemand, newResearch, researchView, runContract, type ResearchState, type ResearchView } from "./research";
import { nextEpisode, type DeflationEpisode, debtAccounts, debtBurdens as computeBurdens, governmentDebt as computeDebt, issueDebt, priceIndex as computePriceIndex, retireDebt, type DebtBurdensView, type GovernmentDebtView } from "./debt";
import { CAR_PER, HOUSE_SHELTERS, REPOSSESSED, REPOSSESSED_ACCOUNT, cohortHousingAccounts, durablesView, foundingDurables, homelessShare, runHousing, runPensions, type DurablesView } from "./housing";
import { alertsFor, assertUnlocked, stagesAt, tutorialFor, type Alert, type LeverStages, type TutorialStep } from "./guide";
import { explainTick, type Explanation } from "./explain";
import { CREATION, DESTRUCTION, beginBatch, checkInvariants, endBatch, emptyLedger, ledgerMoneySupply, post, type Account, type Ledger, type MoneyEvent, type Transaction } from "./ledger";

export type { MoneyEvent, MoneyFlow } from "./ledger";
export type { Explanation } from "./explain";
export { InvariantViolation } from "./ledger";
export type { IndustryView, ProductLine } from "./industry";
export type { Tastes, Tier } from "./products";
export type { BankPolicy, CommercialBankView } from "./bank";
export type { FiscalFlows, TaxRates } from "./tax";
export type { PublicService } from "./education";
export type { ResearchView, TechnologyView, TechnologyStatus, Branch } from "./research";
export type { DebtBurden, DebtBurdensView, GovernmentDebtView } from "./debt";
export type { DurablesView } from "./housing";
export type { Alert, LeverStages, TutorialStep } from "./guide";

export type Command =
  /** Chooses the Technologies to research, up to the number of slots. Replaces the previous choice. */
  | { type: "setResearch"; technologyIds: string[] }
  | { type: "monetize"; amount: number }
  | { type: "grant"; cohortId: string; amount: number }
  | { type: "industryLoan"; industryId: string; amount: number }
  | { type: "setPolicyRate"; rate: number }
  | { type: "setSpreads"; retail?: number; collateralised?: number }
  /** Income tax (on wages) and corporate tax (on profit) in percent, 0 to 100. Omitted rates stay as they are. */
  | { type: "setTaxRates"; income?: number; corporate?: number }
  /** Converts part of an Industry's Industry Loan into an Equity Stake that pays dividends to the Treasury. */
  | { type: "convertLoan"; industryId: string; amount: number }
  /** A Markup / Discount in percent on a Product id or on "wages", applied after discovery. 0 clears it. */
  | { type: "setMarkup"; target: string; percent: number }
  /** The percent of a service's price the Treasury pays to the Industry (a Public Funding Share), 0 to 100. */
  | { type: "setPublicFunding"; service: PublicService; percent: number }
  /** Whether the Government offers Tuition Loans at the Policy Rate. */
  | { type: "setGovernmentEducationLoans"; enabled: boolean }
  /** Sells Government debt to "bank" or a Household Cohort id for their cash. Money only changes hands. */
  | { type: "issueDebt"; holder: string; amount: number }
  /** Pays Treasury cash to retire debt. Debt held by "centralBank" destroys money; any other holder just gets cash back. */
  | { type: "retireDebt"; holder: string; amount: number }
  /** Money the Treasury pays each retired citizen per Tick, as far as the Treasury holds it. */
  | { type: "setPensionRate"; rate: number };

export type { AgeBand, Citizen, Cohort, CohortView, CountrySummary } from "./households";

export interface World {
  seed: number;
  tick: number;
  /** Whether Government levers unlock in stages over the first Days. Absent (old saves) means all open. */
  gradualUnlock?: boolean;
  cohorts: Cohort[];
  /** Share of every cohort's water need that the public supply meets, 0 to 1. */
  waterCoverage: number;
  industries: Industry[];
  /** Experience of the unemployed. Who is unemployed is the working-age population less the jobs held. */
  labor: Labor;
  policy: BankPolicy;
  /** Cohort taste multipliers per Product, which drift each Tick. */
  tastes: Tastes;
  /** Player Markup / Discount in percent, by Product id or "wages". Absent means 0%. */
  markups: Record<string, number>;
  taxes: TaxRates;
  education: EducationPolicy;
  /** Pension payout per retired citizen per Tick, and what was paid on the latest Tick. */
  pensionRate: number;
  pensionsPaid: number;
  /** Taxes and dividends of the latest Tick. */
  flows: FiscalFlows;
  /** Technologies researched, being researched, and their progress. */
  research: ResearchState;
  ledger: Ledger;
  log: MoneyEvent[];
  /** A deflation episode, or null. It starts when a Tick destroys a real share of the money supply and ends once prices have fallen and then recovered to their level before it. */
  deflation: DeflationEpisode | null;
  /** One row per Tick for the charts. */
  history: TickStats[];
  /** Why notable things happened, in the order they happened. */
  notes: Explanation[];
}

/** What the charts plot for one Tick. */
export interface TickStats {
  tick: number;
  moneySupply: number;
  /** Latest price of each Product by id, 0 if never sold. */
  prices: Record<string, number>;
  /** Workers employed across all Industries. */
  employment: number;
  population: number;
  // Welfare Stats, as per-citizen means (hunger and thirst: higher is worse).
  health: number;
  hunger: number;
  thirst: number;
  education: number;
  wealth: number;
}

const TREASURY = "Treasury";
/** A Tick that destroys at least this share of the money supply starts a deflation episode. */
const DEFLATION_TRIGGER = 0.02;

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
    { id: stakeAccount(industry), kind: "asset", holder: TREASURY, isMoney: false },
  ];
}

const COHORTS = [
  { name: "Young Workers", ageBand: "young", education: 40 },
  { name: "Established Families", ageBand: "established", education: 60 },
  { name: "Retirees", ageBand: "retired", education: 50 },
] as const;

/** `housed` is the share of the housing each cohort needs that it starts out owning (default 1). */
export function createWorld(seed: number, options: { waterCoverage?: number; housed?: number; gradualUnlock?: boolean } = {}): World {
  const random = seededRandom(seed);
  const housed = Math.min(1, Math.max(0, options.housed ?? 1));
  const cohorts = COHORTS.map((c, i) => {
    const cohort = newCohort(`cohort-${i}`, c.name, c.ageBand, 20000 + Math.floor(random() * 20000), c.education);
    const houses = Math.ceil((cohort.population * housed) / HOUSE_SHELTERS);
    return { ...cohort, houses, cars: Math.floor(cohort.population / CAR_PER), homelessness: homelessShare(houses, cohort.population) };
  });
  const cohortAccounts = cohorts.flatMap((c): Account[] => [
    { id: `${c.id}:money`, kind: "asset", holder: c.name, isMoney: true },
    { id: `${c.id}:equity`, kind: "equity", holder: c.name, isMoney: false },
    { id: `${c.id}:loanOwed`, kind: "liability", holder: c.name, isMoney: false },
    ...educationLedgerAccounts(c),
    ...cohortHousingAccounts(c),
  ]);
  const industries = newIndustries();
  return {
    seed,
    tick: 0,
    gradualUnlock: options.gradualUnlock ?? false,
    cohorts,
    waterCoverage: options.waterCoverage ?? 1,
    industries,
    labor: newLabor(),
    policy: newPolicy(),
    tastes: neutralTastes(cohorts.map((c) => c.id)),
    markups: {},
    taxes: { income: 0, corporate: 0 },
    education: newEducationPolicy(),
    pensionRate: 0,
    pensionsPaid: 0,
    flows: NO_FLOWS,
    research: newResearch(),
    ledger: withFounding(emptyLedger([
      ...ACCOUNTS,
      ...BANK_ACCOUNTS,
      REPOSSESSED_ACCOUNT,
      { id: "treasury:equity", kind: "equity", holder: TREASURY, isMoney: false },
      ...cohortAccounts,
      ...debtAccounts(cohorts),
      ...industries.flatMap(accountsFor),
    ]), cohorts),
    log: [],
    deflation: null,
    history: [],
    notes: [],
  };
}

function withFounding(ledger: Ledger, cohorts: Cohort[]): Ledger {
  const durables = Object.assign({}, ...cohorts.map(foundingDurables));
  return { ...ledger, balances: { ...ledger.balances, ...FOUNDING_BALANCES, ...durables } };
}

/** Owned houses and cars with their depreciated book value, and each cohort's Collateralised Loan. */
export function durables(world: World): DurablesView[] {
  return durablesView(world.ledger, world.cohorts);
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

/** The tech tree with each Technology's progress and status, and how fast the Research Labs are working. */
export function research(world: World): ResearchView {
  return researchView(world.research, world.industries);
}

export function industries(world: World): IndustryView[] {
  return world.industries.map((industry) => {
    const acct = industryAccounts(industry);
    const { balances } = world.ledger;
    return {
      ...industry,
      experience: industry.skills[industry.id] ?? 0,
      money: balances[acct.money] ?? 0,
      loanOwed: balances[acct.loanOwed] ?? 0,
      equity: balances[acct.equity] ?? 0,
      stake: balances[stakeAccount(industry)] ?? 0,
    };
  });
}

export interface LaborMarketView {
  /** Working-age citizens: every Household Cohort except Retirees. */
  laborForce: number;
  employed: number;
  unemployed: number;
  /** Mean experience of the unemployed, by the Industry it was earned in; it decays while they are out of work. */
  unemployedExperience: Record<string, number>;
}

export function laborMarket(world: World): LaborMarketView {
  const laborForce = workforceOf(world.cohorts);
  const employed = Math.min(laborForce, world.industries.reduce((s, i) => s + i.workers, 0));
  return { laborForce, employed, unemployed: laborForce - employed, unemployedExperience: world.labor.skills };
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
  // Products still locked behind a Technology have no line yet and are not on the market.
  const made = new Set(world.industries.flatMap((i) => i.lines.map((l) => l.productId)));
  return PRODUCTS.filter((def) => made.has(def.id)).map((def) => {
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

/** Tax rates and what the latest Tick collected and paid out. */
export function fiscal(world: World): FiscalFlows & { rates: TaxRates } {
  return { ...world.flows, rates: world.taxes };
}

export interface SectoralBalanceView {
  government: number;
  households: number;
  industries: number;
  commercialBanks: number;
}

/** Net financial position (assets less liabilities) of each sector, which shows where money sits. */
export function sectoralBalance(world: World): SectoralBalanceView {
  const sectorOf = new Map<string, keyof SectoralBalanceView>([[TREASURY, "government"], ["Commercial Bank", "commercialBanks"]]);
  for (const c of world.cohorts) sectorOf.set(c.name, "households");
  for (const i of world.industries) sectorOf.set(i.name, "industries");
  const totals: SectoralBalanceView = { government: 0, households: 0, industries: 0, commercialBanks: 0 };
  for (const account of world.ledger.accounts) {
    const sector = sectorOf.get(account.holder);
    // Houses, cars and repossessed collateral are real assets, not financial positions.
    if (!sector || account.kind === "equity" || /:(houses|cars)$/.test(account.id) || account.id === REPOSSESSED) continue;
    const balance = world.ledger.balances[account.id] ?? 0;
    totals[sector] += account.kind === "asset" ? balance : -balance;
  }
  // An Equity Stake is a claim the Treasury holds on an Industry, so it is that Industry's liability.
  for (const i of world.industries) totals.industries -= world.ledger.balances[stakeAccount(i)] ?? 0;
  return totals;
}

export interface EducationView {
  /** Latest price paid per day of study, after any Markup / Discount, or 0 if never sold. */
  price: number;
  /** Units of education households wanted at the ask last Tick. */
  demand: number;
  /** Citizens studying this Tick, who are out of the workforce. */
  students: number;
  /** Commercial Bank Tuition Loan rate, between its secured and Retail Credit rates. */
  tuitionRate: number;
  /** Rate of Government Tuition Loans, or null while the Government does not offer them. */
  governmentRate: number | null;
  governmentLoans: boolean;
  publicShare: Record<PublicService, number>;
  /** Tuition Loans outstanding, by lender. */
  debt: { bank: number; government: number };
  // Spending in the latest Tick.
  tuitionPaid: number;
  publicSpending: number;
  healthcareFunding: number;
}

export function education(world: World): EducationView {
  const line = world.industries.find((i) => i.id === "healthcare-education")?.lines.find((l) => l.productId === "education");
  const owed = (pick: (id: string) => string) => world.cohorts.reduce((s, c) => s + (world.ledger.balances[pick(c.id)] ?? 0), 0);
  const e = world.education;
  return {
    price: line?.price ?? 0,
    demand: e.demand,
    students: world.cohorts.reduce((s, c) => s + c.students, 0),
    tuitionRate: tuitionRate(world.policy),
    governmentRate: e.governmentLoans ? governmentTuitionRate(world.policy) : null,
    governmentLoans: e.governmentLoans,
    publicShare: e.publicShare,
    debt: { bank: owed((id) => educationAccounts(id).bankLoan), government: owed((id) => educationAccounts(id).govLoan) },
    tuitionPaid: e.tuitionPaid,
    publicSpending: e.publicSpending,
    healthcareFunding: e.healthcareFunding,
  };
}

/** Who holds the Government's debt. */
export function governmentDebt(world: World): GovernmentDebtView {
  return computeDebt(world.ledger, world.cohorts.map((c) => c.id));
}

/** Average Product price relative to the start, 1 at the start. */
export function priceIndex(world: World): number {
  return computePriceIndex(world.industries);
}

/** Nominal and real (price-adjusted) debts of the Government, Industries and Households. */
export function debtBurdens(world: World): DebtBurdensView {
  return computeBurdens(world.ledger, world.industries, world.cohorts.map((c) => c.id));
}

/** Which stages of Government levers are open. Locked commands are rejected by `step`. */
export function leverStages(world: World): LeverStages {
  return stagesAt(world.tick, world.gradualUnlock ?? false);
}

/** Emerging problems: famine, the Commercial Bank halting lending, mass layoffs. */
export function alerts(world: World): Alert[] {
  return alertsFor({ hunger: countrySummary(world).hunger, ledger: world.ledger, employment: history(world).map((h) => h.employment) });
}

/** The first-run steps from zero money, and which are done. */
export function tutorial(world: World): TutorialStep[] {
  return tutorialFor(new Set((world.ledger.flows ?? []).map((f) => f.cause)), world.tick);
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

export function history(world: World): TickStats[] {
  return world.history ?? [];
}

export function explanations(world: World): Explanation[] {
  return world.notes ?? [];
}

export interface FlowLink {
  from: string;
  to: string;
  amount: number;
}

export interface MoneyFlowView {
  /** Money moved between sectors, plus creation into and destruction out of them. Flows within one sector are left out. */
  links: FlowLink[];
  created: number;
  destroyed: number;
}

/** Where money moved between sectors over the Ticks `fromTick` to `toTick` inclusive, with creation and destruction kept apart. */
export function moneyFlows(world: World, fromTick: number, toTick: number): MoneyFlowView {
  const sectorOf = new Map<string, string>([
    [TREASURY, "Government"],
    ["Central Bank", "Government"],
    ["Commercial Bank", "Commercial Banks"],
    [CREATION, CREATION],
    [DESTRUCTION, DESTRUCTION],
  ]);
  for (const c of world.cohorts) sectorOf.set(c.name, "Households");
  for (const i of world.industries) sectorOf.set(i.name, "Industries");
  const totals = new Map<string, FlowLink>();
  let created = 0;
  let destroyed = 0;
  // Flows are posted in Tick order, so walk back from the newest and stop once past the window.
  const all = world.ledger.flows ?? [];
  for (let i = all.length - 1; i >= 0; i--) {
    const f = all[i]!;
    if (f.tick < fromTick) break;
    if (f.tick > toTick) continue;
    const from = sectorOf.get(f.from) ?? f.from;
    const to = sectorOf.get(f.to) ?? f.to;
    if (from === CREATION) created += f.amount;
    if (to === DESTRUCTION) destroyed += f.amount;
    if (from === to) continue;
    const key = `${from}|${to}`;
    const link = totals.get(key) ?? { from, to, amount: 0 };
    link.amount += f.amount;
    totals.set(key, link);
  }
  return { links: [...totals.values()], created, destroyed };
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
  if (world.industries.some((i) => typeof i.capacity !== "number")) {
    throw new Error("Save predates the supply web and cannot be loaded");
  }
  if (!world.labor || world.industries.some((i) => typeof i.workers !== "number")) {
    throw new Error("Save predates the labor market and cannot be loaded");
  }
  if (!world.education) throw new Error("Save predates education and cannot be loaded");
  if (!world.taxes || !world.flows) throw new Error("Save predates taxes and cannot be loaded");
  if (!world.research) throw new Error("Save predates Research and cannot be loaded");
  if (!hasDurables(world.cohorts) || typeof world.pensionRate !== "number") {
    throw new Error("Save predates housing and cannot be loaded");
  }
  if (!hasWelfareStats(world.cohorts) || typeof world.waterCoverage !== "number") {
    throw new Error("Save predates Welfare Stats and cannot be loaded");
  }
  checkInvariants(world.ledger);
  return world;
}

export function step(world: World, commands: Command[]): { world: World; events: MoneyEvent[] } {
  let ledger = beginBatch(world.ledger);
  let started = world.industries;
  let policy = world.policy;
  let markups = world.markups;
  let taxes = world.taxes;
  let eduPolicy = world.education;
  let researchState = world.research;
  let pensionRate = world.pensionRate;
  const events: MoneyEvent[] = [];
  const grain: Record<string, number> = {};
  for (const command of commands) {
    assertUnlocked(command.type, world.tick, world.gradualUnlock ?? false);
    if (command.type === "setPolicyRate" || command.type === "setSpreads") {
      policy = applyPolicy(policy, command);
      continue;
    }
    if (command.type === "setTaxRates") {
      taxes = {
        income: command.income === undefined ? taxes.income : checkRate("Income tax", command.income),
        corporate: command.corporate === undefined ? taxes.corporate : checkRate("Corporate tax", command.corporate),
      };
      continue;
    }
    if (command.type === "setPublicFunding") {
      if (command.service !== "healthcare" && command.service !== "education") throw new Error(`Unknown public service ${command.service}`);
      eduPolicy = { ...eduPolicy, publicShare: { ...eduPolicy.publicShare, [command.service]: checkShare("Public Funding Share", command.percent) } };
      continue;
    }
    if (command.type === "setGovernmentEducationLoans") {
      eduPolicy = { ...eduPolicy, governmentLoans: command.enabled === true };
      continue;
    }
    if (command.type === "setResearch") {
      researchState = chooseActive(researchState, command.technologyIds);
      continue;
    }
    if (command.type === "setPensionRate") {
      if (!Number.isFinite(command.rate) || command.rate < 0) {
        throw new Error(`Pension rate must be a non-negative number, got ${command.rate}`);
      }
      pensionRate = command.rate;
      continue;
    }
    if (command.type === "setMarkup") {
      markups = applyMarkupCommand(markups, command);
      continue;
    }
    const result = post(ledger, toTransaction({ ...world, ledger }, command), world.tick);
    ledger = result.ledger;
    if (result.event) events.push(result.event);
    if (command.type === "industryLoan") {
      started = started.map((i) => (i.id === command.industryId ? startIndustry(i) : i));
    }
  }
  const pensions = runPensions(ledger, world.cohorts, pensionRate, world.tick);
  ledger = pensions.ledger;
  const housing = runHousing(ledger, world.cohorts, started, policy, world.tick);
  ledger = housing.ledger;
  events.push(...housing.events);
  const credit = runRetailCredit(ledger, housing.cohorts, started, policy, world.tick);
  ledger = credit.ledger;
  events.push(...credit.events);
  const tastes = driftTastes(world.tastes, world.seed, world.tick);
  const web = runSupplyWeb(contractDemand(started, researchState), ledger, markups, world.tick, { education: world.education.demand });
  ledger = web.ledger;
  events.push(...web.events);
  // Industries have had first call on the Research Labs' stock; the Government's contract takes what is left.
  const contract = runContract(researchState, web.industries, ledger, world.tick);
  ledger = contract.ledger;
  researchState = contract.state;
  // Households buy the education the other Industries left, then the Treasury pays its healthcare share.
  const school = runEducation(ledger, contract.industries, credit.cohorts, policy, eduPolicy, markups, world.tick);
  ledger = school.ledger;
  events.push(...school.events);
  const care = fundHealthcare(ledger, school.industries, eduPolicy.publicShare.healthcare, world.tick);
  ledger = care.ledger;
  events.push(...care.events);
  const cohortsNext = school.cohorts;
  // In a deflation episode the cost of living the wage floor stands for falls with prices, so wages can follow them down.
  const floorScale = world.deflation ? Math.min(1, computePriceIndex(world.industries) / world.deflation.base) : 1;
  const market = runLabor(care.industries, cohortsNext, world.labor, (i) =>
    labourDemand(i, ledger.balances[industryAccounts(i).money] ?? 0, markups),
  floorScale);
  const payroll = cohortsNext.filter(isWorkingAge).map((c) => ({ id: c.id, population: c.population - Math.min(c.students, c.population) })).filter((c) => c.population > 0);
  const flows: FiscalFlows = { ...NO_FLOWS };
  const next = market.industries.map((industry) => {
    const run = runIndustry(industry, ledger, { cohorts: cohortsNext, tastes, markups, payroll, incomeTax: taxes.income }, world.tick);
    ledger = run.ledger;
    events.push(...run.events);
    flows.incomeTax += run.incomeTax;
    flows.householdSpending += run.householdSpending;
    const payout = payTaxAndDividends(run.industry, ledger, taxes, world.tick);
    ledger = payout.ledger;
    events.push(...payout.events);
    flows.corporateTax += payout.corporateTax;
    flows.dividendsToOwners += payout.toOwners;
    flows.dividendsToTreasury += payout.toTreasury;
    for (const [id, units] of Object.entries(run.fills)) grain[id] = (grain[id] ?? 0) + units;
    return run.industry;
  });
  flows.householdSpending += school.tuitionPaid;
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
  const before = ledgerMoneySupply(world.ledger);
  const contracted = before > 0 && (before - ledgerMoneySupply(ledger)) / before >= DEFLATION_TRIGGER;
  const deflation = nextEpisode(world.deflation ?? null, contracted, computePriceIndex(world.industries), computePriceIndex(next));
  checkInvariants(ledger);
  ledger = endBatch(ledger);
  const after: World = { ...world, tick: world.tick + 1, cohorts: households.cohorts, industries: next, labor: market.labor, policy, tastes, markups, taxes, pensionRate, pensionsPaid: pensions.paid, education: { ...eduPolicy, demand: school.demand, publicSpending: school.publicSpending, healthcareFunding: care.paid, tuitionPaid: school.tuitionPaid }, flows, research: researchState, ledger, log: [...world.log, ...events], deflation };
  const markets = productMarkets(after);
  const summary = countrySummary(after);
  const stats: TickStats = {
    tick: world.tick,
    moneySupply: moneySupply(after),
    prices: Object.fromEntries(markets.map((m) => [m.id, m.price])),
    employment: next.reduce((s, i) => s + i.headcount, 0),
    population: summary.population,
    health: summary.health,
    hunger: summary.hunger,
    thirst: summary.thirst,
    education: summary.education,
    wealth: summary.wealth,
  };
  const notes = explainTick(world.tick, { industries: world.industries, products: productMarkets(world) }, { industries: next, products: markets });
  return { world: { ...after, history: [...history(world), stats], notes: [...explanations(world), ...notes] }, events };
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

function toTransaction(world: World, command: Exclude<Command, { type: "setPolicyRate" | "setSpreads" | "setMarkup" | "setTaxRates" | "setPensionRate" | "setResearch" | "setPublicFunding" | "setGovernmentEducationLoans" }>): Transaction {
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
    case "issueDebt":
      return issueDebt(world.ledger, world.cohorts.map((c) => c.id), command.holder, command.amount);
    case "retireDebt":
      return retireDebt(world.ledger, world.cohorts.map((c) => c.id), command.holder, command.amount);
    case "convertLoan": {
      const industry = world.industries.find((i) => i.id === command.industryId);
      if (!industry) throw new Error(`Unknown Industry ${command.industryId}`);
      const acct = industryAccounts(industry);
      const owed = world.ledger.balances[acct.loanOwed] ?? 0;
      if (command.amount > owed) throw new Error(`${industry.name} owes only ${owed} on its Industry Loan, so ${command.amount} cannot be converted`);
      return {
        type: "equityConversion",
        entries: [
          { account: acct.loanOwed, debit: command.amount },
          { account: "treasury:loansReceivable", credit: command.amount },
          { account: stakeAccount(industry), debit: command.amount },
          { account: acct.equity, credit: command.amount },
        ],
      };
    }
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
