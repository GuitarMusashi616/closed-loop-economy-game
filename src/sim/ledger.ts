export type AccountKind = "asset" | "liability" | "equity";

export interface Account {
  id: string;
  kind: AccountKind;
  /** Holder whose balance sheet the account sits on. */
  holder: string;
  /** Whether the balance counts towards the money supply. */
  isMoney: boolean;
}

export interface Ledger {
  accounts: Account[];
  /** Balances in whole currency units, positive on the account's normal side. */
  balances: Record<string, number>;
  /** Every movement of money between holders, as it was posted. Absent in older saves. */
  flows?: MoneyFlow[];
}

export const CREATION = "Money creation";
export const DESTRUCTION = "Money destruction";

/** Money that moved from one holder to another in one transaction. Creation and destruction use the pseudo-holders above. */
export interface MoneyFlow {
  tick: number;
  from: string;
  to: string;
  amount: number;
  cause: string;
}

/** What a transaction type is allowed to do to the money supply. */
export type SupplyEffect = "create" | "destroy" | "none";

/** The only transaction types, and the only ones allowed to change the money supply. */
export const TRANSACTION_TYPES = {
  monetization: { effect: "create", cause: "Monetization" },
  grant: { effect: "none", cause: "Grant" },
  industryLoan: { effect: "none", cause: "Industry Loan" },
  wages: { effect: "none", cause: "Wages" },
  ageing: { effect: "none", cause: "Ageing" },
  sale: { effect: "none", cause: "Sale" },
  industryRepayment: { effect: "none", cause: "Industry Loan repayment" },
  retailLoan: { effect: "create", cause: "Retail Credit" },
  retailRepayment: { effect: "destroy", cause: "Retail Credit repayment" },
  retailInterest: { effect: "none", cause: "Retail Credit interest" },
  writeOff: { effect: "destroy", cause: "Write-off" },
  writeOffLoss: { effect: "none", cause: "Write-off" },
  incomeTax: { effect: "none", cause: "Income tax" },
  corporateTax: { effect: "none", cause: "Corporate tax" },
  dividend: { effect: "none", cause: "Dividend" },
  equityConversion: { effect: "none", cause: "Equity Stake" },
  bondSale: { effect: "none", cause: "Government debt sale" },
  debtRepayment: { effect: "none", cause: "Government debt repayment" },
  debtRetirement: { effect: "destroy", cause: "Debt retirement" },
  collateralisedLoan: { effect: "create", cause: "Collateralised Loan" },
  collateralisedRepayment: { effect: "destroy", cause: "Collateralised Loan repayment" },
  collateralisedInterest: { effect: "none", cause: "Collateralised Loan interest" },
  durablePurchase: { effect: "none", cause: "Durable purchase" },
  depreciation: { effect: "none", cause: "Depreciation" },
  seizure: { effect: "none", cause: "Collateral seizure" },
  pension: { effect: "none", cause: "Pension" },
} as const satisfies Record<string, { effect: SupplyEffect; cause: string }>;

export type TransactionType = keyof typeof TRANSACTION_TYPES;

export interface Entry {
  account: string;
  debit?: number;
  credit?: number;
}

export interface Transaction {
  type: TransactionType;
  entries: Entry[];
}

export interface MoneyEvent {
  tick: number;
  direction: "created" | "destroyed";
  amount: number;
  cause: string;
}

export class InvariantViolation extends Error {
  constructor(message: string) {
    super(`Ledger invariant violated: ${message}`);
    this.name = "InvariantViolation";
  }
}

export function emptyLedger(accounts: Account[]): Ledger {
  return {
    accounts,
    balances: Object.fromEntries(accounts.map((a) => [a.id, 0])),
    flows: [],
  };
}

export function ledgerMoneySupply(ledger: Ledger): number {
  return ledger.accounts
    .filter((a) => a.isMoney)
    .reduce((sum, a) => sum + (ledger.balances[a.id] ?? 0), 0);
}

/** Posts a balanced transaction. Returns the new ledger and, if the supply moved, its logged event. */
export function post(
  ledger: Ledger,
  tx: Transaction,
  tick: number,
): { ledger: Ledger; event: MoneyEvent | null } {
  const debits = tx.entries.reduce((s, e) => s + (e.debit ?? 0), 0);
  const credits = tx.entries.reduce((s, e) => s + (e.credit ?? 0), 0);
  if (debits !== credits) {
    throw new InvariantViolation(`${tx.type} is unbalanced (debits ${debits}, credits ${credits})`);
  }

  const balances = { ...ledger.balances };
  for (const entry of tx.entries) {
    const account = ledger.accounts.find((a) => a.id === entry.account);
    if (!account) throw new InvariantViolation(`${tx.type} touches unknown account ${entry.account}`);
    const net = (entry.debit ?? 0) - (entry.credit ?? 0);
    balances[account.id] = (balances[account.id] ?? 0) + (account.kind === "asset" ? net : -net);
  }
  const next: Ledger = { accounts: ledger.accounts, balances };

  const delta = ledgerMoneySupply(next) - ledgerMoneySupply(ledger);
  const rules: Record<TransactionType, { effect: SupplyEffect; cause: string }> = TRANSACTION_TYPES;
  const { effect, cause } = rules[tx.type];
  const allowed =
    (effect === "create" && delta > 0) ||
    (effect === "destroy" && delta < 0) ||
    (effect === "none" && delta === 0);
  if (!allowed) {
    throw new InvariantViolation(`${tx.type} may ${effect} money but moved the supply by ${delta}`);
  }

  next.flows = [...(ledger.flows ?? []), ...flowsOf(ledger, next, delta, cause, tick)];

  const event: MoneyEvent | null =
    delta === 0 ? null : { tick, direction: delta > 0 ? "created" : "destroyed", amount: Math.abs(delta), cause };
  return { ledger: next, event };
}

/** Pairs holders whose money fell with holders whose money rose; a created or destroyed amount is one side of the pairing. */
function flowsOf(before: Ledger, after: Ledger, delta: number, cause: string, tick: number): MoneyFlow[] {
  const net = new Map<string, number>();
  for (const a of after.accounts.filter((a) => a.isMoney)) {
    const change = (after.balances[a.id] ?? 0) - (before.balances[a.id] ?? 0);
    if (change !== 0) net.set(a.holder, (net.get(a.holder) ?? 0) + change);
  }
  const givers = [...net].filter(([, c]) => c < 0).map(([h, c]) => ({ holder: h, left: -c }));
  const takers = [...net].filter(([, c]) => c > 0).map(([h, c]) => ({ holder: h, left: c }));
  if (delta > 0) givers.push({ holder: CREATION, left: delta });
  if (delta < 0) takers.push({ holder: DESTRUCTION, left: -delta });
  const flows: MoneyFlow[] = [];
  let t = 0;
  for (const giver of givers) {
    while (giver.left > 0 && t < takers.length) {
      const taker = takers[t]!;
      const amount = Math.min(giver.left, taker.left);
      if (amount > 0) flows.push({ tick, from: giver.holder, to: taker.holder, amount, cause });
      giver.left -= amount;
      taker.left -= amount;
      if (taker.left === 0) t++;
    }
  }
  return flows;
}

/** Throws unless the ledger is internally consistent. */
export function checkInvariants(ledger: Ledger): void {
  let assets = 0;
  let claims = 0;
  for (const account of ledger.accounts) {
    const balance = ledger.balances[account.id];
    if (balance === undefined || !Number.isFinite(balance)) {
      throw new InvariantViolation(`account ${account.id} has no valid balance`);
    }
    if (account.kind !== "equity" && balance < 0) {
      throw new InvariantViolation(`account ${account.id} is negative (${balance})`);
    }
    if (account.kind === "asset") assets += balance;
    else claims += balance;
  }
  if (assets !== claims) {
    throw new InvariantViolation(`assets (${assets}) do not equal liabilities plus equity (${claims})`);
  }
  const issued = (ledger.balances["centralBank:moneyIssued"] ?? 0) + (ledger.balances["bank:depositsIssued"] ?? 0);
  const supply = ledgerMoneySupply(ledger);
  if (issued !== supply) {
    throw new InvariantViolation(`money supply (${supply}) differs from money issued (${issued})`);
  }
}
