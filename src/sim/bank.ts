import { post, type Account, type Ledger, type MoneyEvent, type Transaction } from "./ledger";
import type { Industry } from "./industry";

/** Policy the Government sets for the Commercial Bank. Rates are annual fractions (0.05 is 5%). */
export interface BankPolicy {
  policyRate: number;
  /** Added to the Policy Rate for unsecured Retail Credit. */
  retailSpread: number;
  /** Added to the Policy Rate for Collateralised Loans. */
  collateralisedSpread: number;
}

export interface CommercialBankView {
  policyRate: number;
  rates: { retail: number; collateralised: number };
  loans: number;
  deposits: number;
  money: number;
  equity: number;
  /** Whether the bank has the equity to make any new loan. */
  lending: boolean;
}

export const STARTING_EQUITY = 50_000;
/** Loans may be at most this multiple of equity. */
const LEVERAGE = 10;
/** Missed payments in a row before a loan is written off. */
const DEFAULT_AFTER = 5;
/** A loan is repaid in equal principal instalments over this many Ticks. */
const REPAYMENT_TICKS = 30;
/** A cohort's unsecured debt is limited to this many days of its food spending. */
const CREDIT_LIMIT_DAYS = 3;
const DAYS_PER_YEAR = 365;
/** Units of grain a cohort wants per day, per head (kept equal to the Industry's demand). */
const GRAIN_NEED_PER_HEAD = 0.01;

export function newPolicy(): BankPolicy {
  return { policyRate: 0.03, retailSpread: 0.15, collateralisedSpread: 0.02 };
}

export const BANK_ACCOUNTS: Account[] = [
  { id: "bank:money", kind: "asset", holder: "Commercial Bank", isMoney: true },
  { id: "bank:capital", kind: "asset", holder: "Commercial Bank", isMoney: false },
  { id: "bank:loansReceivable", kind: "asset", holder: "Commercial Bank", isMoney: false },
  { id: "bank:depositsIssued", kind: "liability", holder: "Commercial Bank", isMoney: false },
  { id: "bank:equity", kind: "equity", holder: "Commercial Bank", isMoney: false },
];

/** The founding capital is a non-money asset, so the game still starts with no money. */
export const FOUNDING_BALANCES: Record<string, number> = {
  "bank:capital": STARTING_EQUITY,
  "bank:equity": STARTING_EQUITY,
};

export function lendingRates(policy: BankPolicy) {
  return {
    retail: policy.policyRate + policy.retailSpread,
    collateralised: policy.policyRate + policy.collateralisedSpread,
  };
}

const bal = (ledger: Ledger, account: string) => ledger.balances[account] ?? 0;

export function bankView(ledger: Ledger, policy: BankPolicy): CommercialBankView {
  return {
    policyRate: policy.policyRate,
    rates: lendingRates(policy),
    loans: bal(ledger, "bank:loansReceivable"),
    deposits: bal(ledger, "bank:depositsIssued"),
    money: bal(ledger, "bank:money"),
    equity: bal(ledger, "bank:equity"),
    lending: lendingCapacity(ledger) > 0,
  };
}

function lendingCapacity(ledger: Ledger): number {
  const equity = bal(ledger, "bank:equity");
  if (equity <= 0) return 0;
  return Math.max(0, Math.floor(equity * LEVERAGE) - bal(ledger, "bank:loansReceivable"));
}

export interface CohortCredit {
  id: string;
  population: number;
  missedPayments: number;
}

/** One Tick of Retail Credit: service existing loans (interest, repayment, default), then lend to cohorts short of food money. */
export function runRetailCredit<C extends CohortCredit>(
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
  const rate = lendingRates(policy).retail;
  const asks = industries.filter((i) => i.started).flatMap((i) => i.lines.filter((l) => l.productId === "grain").map((l) => l.ask));
  const foodPrice = asks.length > 0 ? Math.min(...asks) : 0;

  const next = cohorts.map((cohort) => {
    const cash = `${cohort.id}:money`;
    const owedAccount = `${cohort.id}:loanOwed`;
    let missed = cohort.missedPayments;
    const owed = bal(ledger, owedAccount);

    if (owed > 0) {
      const interest = Math.ceil((owed * rate) / DAYS_PER_YEAR);
      const principal = Math.min(owed, Math.ceil(owed / REPAYMENT_TICKS));
      if (bal(ledger, cash) >= interest + principal) {
        missed = 0;
        if (interest > 0) {
          apply({
            type: "retailInterest",
            entries: [
              { account: `${cohort.id}:equity`, debit: interest },
              { account: cash, credit: interest },
              { account: "bank:money", debit: interest },
              { account: "bank:equity", credit: interest },
            ],
          });
        }
        apply({
          type: "retailRepayment",
          entries: [
            { account: owedAccount, debit: principal },
            { account: cash, credit: principal },
            { account: "bank:depositsIssued", debit: principal },
            { account: "bank:loansReceivable", credit: principal },
          ],
        });
      } else if (++missed >= DEFAULT_AFTER) {
        missed = 0;
        // The loss is paid out of the bank's own cash where it has any, which retires those deposits.
        const destroyed = Math.min(owed, bal(ledger, "bank:money"));
        apply({
          type: destroyed > 0 ? "writeOff" : "writeOffLoss",
          entries: [
            { account: owedAccount, debit: owed },
            { account: `${cohort.id}:equity`, credit: owed },
            { account: "bank:equity", debit: owed },
            { account: "bank:loansReceivable", credit: owed },
            ...(destroyed > 0
              ? [
                  { account: "bank:depositsIssued", debit: destroyed },
                  { account: "bank:money", credit: destroyed },
                ]
              : []),
          ],
        });
      }
    }

    if (missed === 0 && foodPrice > 0) {
      const dailyCost = Math.floor(cohort.population * GRAIN_NEED_PER_HEAD) * foodPrice;
      const headroom = dailyCost * CREDIT_LIMIT_DAYS - bal(ledger, owedAccount);
      const amount = Math.min(dailyCost - bal(ledger, cash), headroom, lendingCapacity(ledger));
      if (amount > 0) {
        apply({
          type: "retailLoan",
          entries: [
            { account: "bank:loansReceivable", debit: amount },
            { account: "bank:depositsIssued", credit: amount },
            { account: cash, debit: amount },
            { account: owedAccount, credit: amount },
          ],
        });
      }
    }
    return { ...cohort, missedPayments: missed };
  });
  return { ledger, cohorts: next, events };
}
