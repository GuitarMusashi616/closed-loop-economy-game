import { post, type Account, type Ledger, type MoneyEvent, type Transaction, balanceOf } from "./ledger";
import { lendingCapacity, lendingRates, type BankPolicy } from "./bank";
import type { Industry } from "./industry";

/** Durables are owned assets. Units are scaled to the cohort model: one "house" shelters a block of citizens. */
export const HOUSE_SHELTERS = 1000;
export const HOUSE_PRICE = 800;
/** One car per this many citizens. */
export const CAR_PER = 500;
export const CAR_PRICE = 300;
/** Share of the remaining book value lost to depreciation each Tick. */
const HOUSE_DEPRECIATION = 0.0002;
const CAR_DEPRECIATION = 0.001;
const DAYS_PER_YEAR = 365;
/** A Collateralised Loan is repaid in equal principal instalments over this many Ticks. */
const REPAYMENT_TICKS = 360;
/** Missed payments in a row before the collateral is seized. */
const SEIZE_AFTER = 5;
/** A cohort must hold this many Ticks of payments in cash before it will borrow. */
const AFFORDABILITY_TICKS = 3;

/** Fraction of a cohort's citizens with no house to live in. */
export function homelessShare(houses: number, population: number): number {
  return population <= 0 ? 0 : Math.min(1, Math.max(0, 1 - (houses * HOUSE_SHELTERS) / population));
}

/** Cohorts only borrow once the shortfall passes a tolerance, so small population drift does not trigger purchases. */
export function housesNeeded(population: number): number {
  return Math.ceil((population * 0.98) / HOUSE_SHELTERS);
}

export function carsWanted(population: number): number {
  return Math.floor((population * 0.9) / CAR_PER);
}

export function cohortHousingAccounts(c: { id: string; name: string }): Account[] {
  return [
    { id: `${c.id}:houses`, kind: "asset", holder: c.name, isMoney: false },
    { id: `${c.id}:cars`, kind: "asset", holder: c.name, isMoney: false },
    { id: `${c.id}:securedOwed`, kind: "liability", holder: c.name, isMoney: false },
  ];
}

export const REPOSSESSED = "bank:repossessed";
export const REPOSSESSED_ACCOUNT: Account = { id: REPOSSESSED, kind: "asset", holder: "Commercial Bank", isMoney: false };

/** Opening balances for a cohort's starting durables (owned outright, so they sit against equity). */
export function foundingDurables(c: { id: string; houses: number; cars: number }): Record<string, number> {
  const value = c.houses * HOUSE_PRICE + c.cars * CAR_PRICE;
  return { [`${c.id}:houses`]: c.houses * HOUSE_PRICE, [`${c.id}:cars`]: c.cars * CAR_PRICE, [`${c.id}:equity`]: value };
}


export interface DurablesView {
  cohortId: string;
  houses: number;
  cars: number;
  /** Book value after depreciation. */
  houseValue: number;
  carValue: number;
  /** Collateralised Loan outstanding. */
  securedDebt: number;
}

export interface HousingCohort {
  id: string;
  population: number;
  houses: number;
  cars: number;
  securedMissed: number;
}

export function durablesView(ledger: Ledger, cohorts: HousingCohort[]): DurablesView[] {
  return cohorts.map((c) => ({
    cohortId: c.id,
    houses: c.houses,
    cars: c.cars,
    houseValue: balanceOf(ledger, `${c.id}:houses`),
    carValue: balanceOf(ledger, `${c.id}:cars`),
    securedDebt: balanceOf(ledger, `${c.id}:securedOwed`),
  }));
}

/** One Tick of durables: depreciate, service Collateralised Loans (seizing collateral on default), then lend for needed houses and cars. */
export function runHousing<C extends HousingCohort>(
  ledger: Ledger,
  cohorts: C[],
  industries: Industry[],
  policy: BankPolicy,
  tick: number,
): { ledger: Ledger; cohorts: C[]; events: MoneyEvent[] } {
  const events: MoneyEvent[] = [];
  const apply = (tx: Transaction) => {
    const result = post(ledger, tx, tick);
    ledger = result.ledger;
    if (result.event) events.push(result.event);
  };
  const rate = lendingRates(policy).collateralised;
  const isStarted = (id: string) => industries.some((i) => i.id === id && i.started);

  const next = cohorts.map((cohort) => {
    let { houses, cars, securedMissed: missed } = cohort;
    const cash = `${cohort.id}:money`;
    const owedAccount = `${cohort.id}:securedOwed`;

    for (const [kind, depreciation] of [["houses", HOUSE_DEPRECIATION], ["cars", CAR_DEPRECIATION]] as const) {
      const value = balanceOf(ledger, `${cohort.id}:${kind}`);
      const loss = Math.min(value, Math.ceil(value * depreciation));
      if (loss > 0) {
        apply({ type: "depreciation", entries: [{ account: `${cohort.id}:equity`, debit: loss }, { account: `${cohort.id}:${kind}`, credit: loss }] });
      }
    }

    const owed = balanceOf(ledger, owedAccount);
    if (owed > 0) {
      const interest = Math.ceil((owed * rate) / DAYS_PER_YEAR);
      const principal = Math.min(owed, Math.ceil(owed / REPAYMENT_TICKS));
      if (balanceOf(ledger, cash) >= interest + principal) {
        missed = 0;
        if (interest > 0) {
          apply({
            type: "collateralisedInterest",
            entries: [
              { account: `${cohort.id}:equity`, debit: interest },
              { account: cash, credit: interest },
              { account: "bank:money", debit: interest },
              { account: "bank:equity", credit: interest },
            ],
          });
        }
        apply({
          type: "collateralisedRepayment",
          entries: [
            { account: owedAccount, debit: principal },
            { account: cash, credit: principal },
            { account: "bank:depositsIssued", debit: principal },
            { account: "bank:loansReceivable", credit: principal },
          ],
        });
      } else if (++missed >= SEIZE_AFTER) {
        missed = 0;
        // Collateral is seized at book value, cars before houses, until it covers the debt or runs out.
        const seize = (kind: "cars" | "houses", count: number, target: number) => {
          const value = balanceOf(ledger, `${cohort.id}:${kind}`);
          const unit = count > 0 ? Math.floor(value / count) : 0;
          const units = unit > 0 ? Math.min(count, Math.ceil(Math.max(0, target) / unit)) : 0;
          return { units, value: units === count ? value : units * unit };
        };
        const car = seize("cars", cars, owed);
        const house = seize("houses", houses, owed - car.value);
        const seized = car.value + house.value;
        const loss = Math.max(0, owed - seized);
        const surplus = Math.max(0, seized - owed);
        const destroyed = Math.min(loss, balanceOf(ledger, "bank:money"));
        apply({
          type: destroyed > 0 ? "writeOff" : "seizure",
          entries: [
            { account: owedAccount, debit: owed },
            ...(car.value > 0 ? [{ account: `${cohort.id}:cars`, credit: car.value }] : []),
            ...(house.value > 0 ? [{ account: `${cohort.id}:houses`, credit: house.value }] : []),
            ...(seized > 0 ? [{ account: REPOSSESSED, debit: seized }] : []),
            ...(loss > 0 ? [{ account: `${cohort.id}:equity`, credit: loss }, { account: "bank:equity", debit: loss }] : []),
            ...(surplus > 0 ? [{ account: `${cohort.id}:equity`, debit: surplus }, { account: "bank:equity", credit: surplus }] : []),
            { account: "bank:loansReceivable", credit: owed },
            ...(destroyed > 0 ? [{ account: "bank:depositsIssued", debit: destroyed }, { account: "bank:money", credit: destroyed }] : []),
          ],
        });
        cars -= car.units;
        houses -= house.units;
      }
    }

    // Lend for one purchase per Tick: a house if citizens are unhoused, otherwise a car.
    if (missed === 0) {
      const buy =
        houses < housesNeeded(cohort.population) ? ({ kind: "houses", price: HOUSE_PRICE, seller: "construction" } as const)
        : cars < carsWanted(cohort.population) ? ({ kind: "cars", price: CAR_PRICE, seller: "manufacturing" } as const)
        : null;
      if (buy && isStarted(buy.seller) && lendingCapacity(ledger) >= buy.price) {
        const debt = balanceOf(ledger, owedAccount) + buy.price;
        const payment = Math.ceil(debt / REPAYMENT_TICKS) + Math.ceil((debt * rate) / DAYS_PER_YEAR);
        if (balanceOf(ledger, cash) >= AFFORDABILITY_TICKS * payment) {
          apply({
            type: "collateralisedLoan",
            entries: [
              { account: "bank:loansReceivable", debit: buy.price },
              { account: "bank:depositsIssued", credit: buy.price },
              { account: cash, debit: buy.price },
              { account: owedAccount, credit: buy.price },
            ],
          });
          apply({
            type: "durablePurchase",
            entries: [
              { account: `${cohort.id}:${buy.kind}`, debit: buy.price },
              { account: cash, credit: buy.price },
              { account: `${buy.seller}:money`, debit: buy.price },
              { account: `${buy.seller}:equity`, credit: buy.price },
            ],
          });
          if (buy.kind === "houses") houses += 1;
          else cars += 1;
        }
      }
    }
    return { ...cohort, houses, cars, securedMissed: missed };
  });
  return { ledger, cohorts: next, events };
}

/** Pays each retired cohort `rate` money per citizen from the Treasury, up to what the Treasury holds. */
export function runPensions<C extends { id: string; ageBand: string; population: number }>(
  ledger: Ledger,
  cohorts: C[],
  rate: number,
  tick: number,
): { ledger: Ledger; paid: number } {
  let paid = 0;
  for (const c of cohorts) {
    if (c.ageBand !== "retired") continue;
    const amount = Math.min(Math.floor(c.population * rate), balanceOf(ledger, "treasury:money"));
    if (amount <= 0) continue;
    ledger = post(
      ledger,
      {
        type: "pension",
        entries: [
          { account: "treasury:equity", debit: amount },
          { account: "treasury:money", credit: amount },
          { account: `${c.id}:money`, debit: amount },
          { account: `${c.id}:equity`, credit: amount },
        ],
      },
      tick,
    ).ledger;
    paid += amount;
  }
  return { ledger, paid };
}
