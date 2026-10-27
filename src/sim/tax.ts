import { post, type Ledger, type MoneyEvent, type Transaction, balanceOf } from "./ledger";
import { industryAccounts, type Industry } from "./industry";

/** Tax rates the player sets, in percent of wages (income) and of profit (corporate). */
export interface TaxRates {
  income: number;
  corporate: number;
}

/** What the Treasury and Households received on the latest Tick, for display. */
export interface FiscalFlows {
  incomeTax: number;
  corporateTax: number;
  dividendsToOwners: number;
  dividendsToTreasury: number;
  /** Money Households paid Industries for Products this Tick. */
  householdSpending: number;
}

export const NO_FLOWS: FiscalFlows = { incomeTax: 0, corporateTax: 0, dividendsToOwners: 0, dividendsToTreasury: 0, householdSpending: 0 };

/** The Household Cohort that owns the privately held part of every Industry. */
export const OWNER_COHORT = "cohort-1";
/** Share of after-tax profit an Industry keeps; the rest is paid out as dividends. */
export const RETAINED_SHARE = 0.3;
/** Private capital in each Industry, against which a Government Equity Stake is measured. */
export const PRIVATE_EQUITY = 20_000;

export const stakeAccount = (industry: { id: string }) => `${industry.id}:stake`;

export function checkRate(name: string, percent: number): number {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new Error(`${name} must be a percent from 0 to 100, got ${percent}`);
  }
  return percent;
}

/** The Treasury's share of an Industry's dividends, set by how much of it the Government owns. */
export function governmentShare(stake: number): number {
  return stake <= 0 ? 0 : stake / (stake + PRIVATE_EQUITY);
}


/**
 * An Industry's profit this Tick is taxed, part of what is left is retained and the rest is paid as
 * dividends, to the Owner Cohort and in proportion to any Equity Stake to the Treasury. An Industry
 * never pays out the cash it needs to cover next Tick's wages.
 */
export function payTaxAndDividends(
  industry: Industry,
  ledger: Ledger,
  rates: TaxRates,
  tick: number,
): { ledger: Ledger; events: MoneyEvent[]; corporateTax: number; toOwners: number; toTreasury: number } {
  const none = { ledger, events: [], corporateTax: 0, toOwners: 0, toTreasury: 0 };
  if (!industry.started) return none;
  const acct = industryAccounts(industry);
  const events: MoneyEvent[] = [];
  const apply = (tx: Transaction) => {
    const result = post(ledger, tx, tick);
    ledger = result.ledger;
    if (result.event) events.push(result.event);
  };
  const pay = (type: "corporateTax" | "dividend", to: string, amount: number) => {
    if (amount <= 0) return;
    apply({
      type,
      entries: [
        { account: acct.equity, debit: amount },
        { account: acct.money, credit: amount },
        { account: `${to}:money`, debit: amount },
        { account: `${to}:equity`, credit: amount },
      ],
    });
  };

  const profit = Math.max(0, industry.revenue - industry.costs);
  const corporateTax = Math.min(Math.floor((profit * rates.corporate) / 100), balanceOf(ledger, acct.money));
  pay("corporateTax", "treasury", corporateTax);

  const reserve = industry.targetHeadcount * industry.wage;
  const dividend = Math.min(Math.floor((profit - corporateTax) * (1 - RETAINED_SHARE)), Math.max(0, balanceOf(ledger, acct.money) - reserve));
  const toTreasury = Math.floor(dividend * governmentShare(balanceOf(ledger, stakeAccount(industry))));
  pay("dividend", "treasury", toTreasury);
  pay("dividend", OWNER_COHORT, dividend - toTreasury);
  return { ledger, events, corporateTax, toOwners: dividend - toTreasury, toTreasury };
}
