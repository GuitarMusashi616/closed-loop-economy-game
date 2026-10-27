import type { Account, Ledger, Transaction } from "./ledger";
import { industryAccounts, startingAsk, type Industry } from "./industry";

/** Who can hold Government debt besides the Central Bank, which Monetization already covers. */
const BANK = "bank";
const CENTRAL_BANK = "centralBank";

export interface GovernmentDebtView {
  /** What the Treasury owes in total. */
  owed: number;
  centralBank: number;
  commercialBank: number;
  households: number;
}

export interface DebtBurden {
  nominal: number;
  /** Nominal debt in units of the starting price level: it rises when prices fall. */
  real: number;
}

export interface DebtBurdensView {
  priceIndex: number;
  government: DebtBurden;
  industries: DebtBurden;
  households: DebtBurden;
}

/** Ledger accounts for Government debt held by the Commercial Bank and by each Household Cohort. */
export function debtAccounts(cohorts: { id: string; name: string }[]): Account[] {
  return [
    { id: "bank:govDebt", kind: "asset", holder: "Commercial Bank", isMoney: false },
    ...cohorts.map((c): Account => ({ id: `${c.id}:govDebt`, kind: "asset", holder: c.name, isMoney: false })),
  ];
}

const bal = (ledger: Ledger, id: string) => ledger.balances[id] ?? 0;

function holderAccounts(holder: string, cohortIds: string[]): { money: string; debt: string } {
  if (holder === CENTRAL_BANK) return { money: "centralBank:moneyIssued", debt: "centralBank:govDebtHeld" };
  if (holder === BANK) return { money: "bank:money", debt: "bank:govDebt" };
  if (cohortIds.includes(holder)) return { money: `${holder}:money`, debt: `${holder}:govDebt` };
  throw new Error(`Unknown debt holder ${holder}`);
}

/** The Treasury sells debt to the Commercial Bank or a Household Cohort for their cash. Money only changes hands. */
export function issueDebt(ledger: Ledger, cohortIds: string[], holder: string, amount: number): Transaction {
  if (holder === CENTRAL_BANK) throw new Error("The Central Bank takes debt only through Monetization; use monetize");
  const { money, debt } = holderAccounts(holder, cohortIds);
  if (bal(ledger, money) < amount) throw new Error(`${holder} has only ${bal(ledger, money)} to lend, so ${amount} of debt cannot be sold`);
  return {
    type: "bondSale",
    entries: [
      { account: "treasury:money", debit: amount },
      { account: "treasury:debtOwed", credit: amount },
      { account: debt, debit: amount },
      { account: money, credit: amount },
    ],
  };
}

/**
 * The Treasury pays cash to retire debt. Debt held by the Central Bank is cancelled against the money it
 * issued, so the money disappears. Debt held by anyone else just returns their cash.
 */
export function retireDebt(ledger: Ledger, cohortIds: string[], holder: string, amount: number): Transaction {
  const { money, debt } = holderAccounts(holder, cohortIds);
  if (bal(ledger, debt) < amount) throw new Error(`${holder} holds only ${bal(ledger, debt)} of Government debt, so ${amount} cannot be retired`);
  if (bal(ledger, "treasury:money") < amount) throw new Error(`Treasury has only ${bal(ledger, "treasury:money")}, so ${amount} of debt cannot be retired`);
  if (holder === CENTRAL_BANK) {
    return {
      type: "debtRetirement",
      entries: [
        { account: "treasury:debtOwed", debit: amount },
        { account: "treasury:money", credit: amount },
        { account: money, debit: amount },
        { account: debt, credit: amount },
      ],
    };
  }
  return {
    type: "debtRepayment",
    entries: [
      { account: "treasury:debtOwed", debit: amount },
      { account: "treasury:money", credit: amount },
      { account: money, debit: amount },
      { account: debt, credit: amount },
    ],
  };
}

export function governmentDebt(ledger: Ledger, cohortIds: string[]): GovernmentDebtView {
  return {
    owed: bal(ledger, "treasury:debtOwed"),
    centralBank: bal(ledger, "centralBank:govDebtHeld"),
    commercialBank: bal(ledger, "bank:govDebt"),
    households: cohortIds.reduce((s, id) => s + bal(ledger, `${id}:govDebt`), 0),
  };
}

/** Average price of the Products on sale relative to what Industries first asked, 1 at the start. */
export function priceIndex(industries: Industry[]): number {
  const ratios = industries.flatMap((i) =>
    i.lines.filter((l) => l.price > 0).map((l) => l.price / startingAsk(i.id, l.productId)),
  );
  return ratios.length === 0 ? 1 : ratios.reduce((s, r) => s + r, 0) / ratios.length;
}

export function debtBurdens(ledger: Ledger, industries: Industry[], cohortIds: string[]): DebtBurdensView {
  const index = priceIndex(industries);
  const burden = (nominal: number): DebtBurden => ({ nominal, real: nominal / index });
  return {
    priceIndex: index,
    government: burden(bal(ledger, "treasury:debtOwed")),
    industries: burden(industries.reduce((s, i) => s + bal(ledger, industryAccounts(i).loanOwed), 0)),
    households: burden(cohortIds.reduce((s, id) => s + bal(ledger, `${id}:loanOwed`), 0)),
  };
}

export interface DeflationEpisode {
  /** The price level before the contraction. */
  base: number;
  /** Whether prices have fallen clearly below `base` yet; the episode cannot end before they do. */
  fell: boolean;
}

/** Advances a deflation episode: one starts on a contraction and ends once prices fell and are back at their old level. */
export function nextEpisode(episode: DeflationEpisode | null, contracted: boolean, before: number, after: number): DeflationEpisode | null {
  if (!episode) return contracted ? { base: before, fell: false } : null;
  const fell = episode.fell || after < episode.base * 0.95;
  return fell && after >= episode.base ? null : { base: episode.base, fell };
}
