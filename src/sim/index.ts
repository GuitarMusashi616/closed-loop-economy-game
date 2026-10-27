import { seededRandom } from "./rng";
import { checkInvariants, emptyLedger, ledgerMoneySupply, post, type Account, type Ledger, type MoneyEvent, type Transaction } from "./ledger";

export type { MoneyEvent } from "./ledger";
export { InvariantViolation } from "./ledger";

export type Command =
  | { type: "monetize"; amount: number }
  | { type: "grant"; cohortId: string; amount: number };

export interface Cohort {
  id: string;
  name: string;
  population: number;
}

export interface World {
  seed: number;
  tick: number;
  cohorts: Cohort[];
  ledger: Ledger;
  log: MoneyEvent[];
}

const TREASURY = "Treasury";

const ACCOUNTS: Account[] = [
  { id: "centralBank:moneyIssued", kind: "liability", holder: "Central Bank", isMoney: false },
  { id: "centralBank:govDebtHeld", kind: "asset", holder: "Central Bank", isMoney: false },
  { id: "treasury:money", kind: "asset", holder: TREASURY, isMoney: true },
  { id: "treasury:debtOwed", kind: "liability", holder: TREASURY, isMoney: false },
];

const COHORT_NAMES = ["Young Workers", "Established Families", "Retirees"];

export function createWorld(seed: number): World {
  const random = seededRandom(seed);
  const cohorts = COHORT_NAMES.map((name, i) => ({
    id: `cohort-${i}`,
    name,
    population: 20000 + Math.floor(random() * 20000),
  }));
  const cohortAccounts = cohorts.flatMap((c): Account[] => [
    { id: `${c.id}:money`, kind: "asset", holder: c.name, isMoney: true },
    { id: `${c.id}:equity`, kind: "equity", holder: c.name, isMoney: false },
  ]);
  return {
    seed,
    tick: 0,
    cohorts,
    ledger: emptyLedger([...ACCOUNTS, { id: "treasury:equity", kind: "equity", holder: TREASURY, isMoney: false }, ...cohortAccounts]),
    log: [],
  };
}

export function cohorts(world: World): Cohort[] {
  return world.cohorts;
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
  checkInvariants(world.ledger);
  return world;
}

export function step(world: World, commands: Command[]): { world: World; events: MoneyEvent[] } {
  let ledger = world.ledger;
  const events: MoneyEvent[] = [];
  for (const command of commands) {
    const result = post(ledger, toTransaction(world, command), world.tick);
    ledger = result.ledger;
    if (result.event) events.push(result.event);
  }
  checkInvariants(ledger);
  return { world: { ...world, tick: world.tick + 1, ledger, log: [...world.log, ...events] }, events };
}

function toTransaction(world: World, command: Command): Transaction {
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
