import { post, type Account, type Ledger, type MoneyEvent, type Transaction } from "./ledger";
import { clearAuction, type Buyer } from "./market";
import { applyMarkup, productDef } from "./products";
import { askFor, industryAccounts, nextAsk, stockOf, take, type Industry } from "./industry";
import { lendingRates, type BankPolicy } from "./bank";

export type PublicService = "healthcare" | "education";

/** What the player has set for education and public services, and what households last asked for. */
export interface EducationPolicy {
  /** Percent of each service's price that the Treasury pays to the Industry, 0 to 100. */
  publicShare: Record<PublicService, number>;
  /** Whether the Government offers Tuition Loans at the Policy Rate, below any market rate. */
  governmentLoans: boolean;
  /** Units of education households asked for last Tick, which tells the Industry how much to make. */
  demand: number;
  /** Latest Tick's spending, for display. */
  publicSpending: number;
  healthcareFunding: number;
  tuitionPaid: number;
}

export const newEducationPolicy = (): EducationPolicy => ({
  publicShare: { healthcare: 0, education: 0 },
  governmentLoans: false,
  demand: 0,
  publicSpending: 0,
  healthcareFunding: 0,
  tuitionPaid: 0,
});

/** Share of a cohort's working-age citizens who want to study on any one Tick. */
export const ENROLL_SHARE = 0.005;
/** Education points a studying citizen gains per day (the cohort mean moves by this times the student share). */
const STUDY_GAIN = 5;
/** Debt a student will carry is this divided by the loan rate, per citizen wanting to study. */
const DEBT_BUDGET = 40;
/** A student who borrows values a study day at this multiple of the cash price, before the cost of the loan. */
const FINANCED_VALUE = 1;
/** Years over which a loan weighs on a borrower's willingness to pay. */
const PAYBACK_YEARS = 5;
/**
 * What a citizen who must borrow will pay for a day of study: the value of the education over
 * their career, discounted by the loan rate. Cheap loans mean they will bid more, so tuition rises.
 */
export const borrowerWtp = (cashWtp: number, rate: number) => Math.round((cashWtp * FINANCED_VALUE) / (1 + rate * PAYBACK_YEARS));
/** Tuition Loans are repaid in equal principal instalments over this many Ticks. */
const REPAYMENT_TICKS = 30;
const DAYS_PER_YEAR = 365;

export const EDUCATION_INDUSTRY = "healthcare-education";

export const educationAccounts = (cohortId: string) => ({
  bankLoan: `${cohortId}:tuitionBank`,
  govLoan: `${cohortId}:tuitionGov`,
});

export function educationLedgerAccounts(cohort: { id: string; name: string }): Account[] {
  const a = educationAccounts(cohort.id);
  return [
    { id: a.bankLoan, kind: "liability", holder: cohort.name, isMoney: false },
    { id: a.govLoan, kind: "liability", holder: cohort.name, isMoney: false },
  ];
}

/** The Commercial Bank's Tuition Loan rate: halfway between its secured and Retail Credit rates. */
export function tuitionRate(policy: BankPolicy): number {
  const { retail, collateralised } = lendingRates(policy);
  return (retail + collateralised) / 2;
}

/** The cheap Government Tuition Loan rate: the Policy Rate itself, below the secured rate. */
export const governmentTuitionRate = (policy: BankPolicy) => policy.policyRate;

export function checkShare(name: string, percent: number): number {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new Error(`${name} must be between 0 and 100, got ${percent}`);
  }
  return percent;
}

interface CohortLike {
  id: string;
  population: number;
  ageBand: string;
  students: number;
  education: number;
}

const bal = (ledger: Ledger, account: string) => ledger.balances[account] ?? 0;
const workingAge = (c: CohortLike) => c.ageBand !== "retired";

export interface EducationTick<C> {
  ledger: Ledger;
  industries: Industry[];
  cohorts: C[];
  events: MoneyEvent[];
  /** Units of education the cohorts wanted at the ask. */
  demand: number;
  /** What the Treasury paid towards tuition this Tick. */
  publicSpending: number;
  /** What students paid out of their own pockets. */
  tuitionPaid: number;
}

/**
 * One Tick of education: students service their Tuition Loans, then the cohorts bid for the
 * education Healthcare and Education has made. Each unit bought is a day of study, so a citizen
 * studies only on the days they buy one, and is out of the workforce meanwhile. Citizens pay
 * from cash, then a Tuition Loan: from the Government if it offers them, else the Commercial Bank.
 */
export function runEducation<C extends CohortLike>(
  ledger: Ledger,
  industries: Industry[],
  cohorts: C[],
  policy: BankPolicy,
  education: EducationPolicy,
  markups: Record<string, number>,
  tick: number,
): EducationTick<C> {
  const events: MoneyEvent[] = [];
  const apply = (tx: Transaction) => {
    const result = post(ledger, tx, tick);
    ledger = result.ledger;
    if (result.event) events.push(result.event);
  };
  const bankRate = tuitionRate(policy);
  const govRate = governmentTuitionRate(policy);

  // Servicing: interest first, then principal, from whatever cash the cohort has. A student who
  // cannot pay simply falls behind; the debt stays and caps what they can borrow.
  for (const c of cohorts) {
    const cash = `${c.id}:money`;
    const acct = educationAccounts(c.id);
    for (const [account, rate, lender] of [[acct.bankLoan, bankRate, "bank"], [acct.govLoan, govRate, "gov"]] as const) {
      const owed = bal(ledger, account);
      if (owed <= 0) continue;
      const interest = Math.min(bal(ledger, cash), Math.ceil((owed * rate) / DAYS_PER_YEAR));
      const principal = Math.min(owed, Math.ceil(owed / REPAYMENT_TICKS), bal(ledger, cash) - interest);
      const bank = lender === "bank";
      if (interest > 0) {
        apply({
          type: "tuitionInterest",
          entries: [
            { account: `${c.id}:equity`, debit: interest },
            { account: cash, credit: interest },
            { account: bank ? "bank:money" : "treasury:money", debit: interest },
            { account: bank ? "bank:equity" : "treasury:equity", credit: interest },
          ],
        });
      }
      if (principal > 0) {
        apply({
          type: bank ? "tuitionRepayment" : "governmentTuitionRepayment",
          entries: [
            { account, debit: principal },
            { account: cash, credit: principal },
            bank ? { account: "bank:depositsIssued", debit: principal } : { account: "treasury:money", debit: principal },
            { account: bank ? "bank:loansReceivable" : "treasury:loansReceivable", credit: principal },
          ],
        });
      }
    }
  }

  const index = industries.findIndex((i) => i.id === EDUCATION_INDUSTRY);
  const industry = industries[index];
  const lineIndex = industry ? industry.lines.findIndex((l) => l.productId === "education") : -1;
  if (!industry || lineIndex < 0 || !industry.started) {
    return { ledger, industries, cohorts: cohorts.map((c) => ({ ...c, students: 0 })), events, demand: 0, publicSpending: 0, tuitionPaid: 0 };
  }
  const line = industry.lines[lineIndex]!;
  const seller = industryAccounts(industry);
  const supply = stockOf(line);
  const share = education.publicShare.education;
  const def = productDef("education");

  const lender = (): "gov" | "bank" => (education.governmentLoans && bal(ledger, "treasury:money") > 0 ? "gov" : "bank");
  const rateOf = (l: "gov" | "bank") => (l === "gov" ? govRate : bankRate);
  const debtOf = (c: C) => bal(ledger, educationAccounts(c.id).bankLoan) + bal(ledger, educationAccounts(c.id).govLoan);
  // A dearer loan means a student takes on less debt, so cheap Government loans lift demand.
  const debtCap = (c: C, l: "gov" | "bank") => Math.floor(c.population * ENROLL_SHARE * (DEBT_BUDGET / Math.max(0.01, rateOf(l))));
  const room = (c: C) => {
    const l = lender();
    const lendable = l === "gov" ? bal(ledger, "treasury:money") : Number.MAX_SAFE_INTEGER;
    return Math.max(0, Math.min(debtCap(c, l) - debtOf(c), lendable));
  };

  const wantsUnits = (c: C) => Math.floor(c.population * ENROLL_SHARE);
  const buyers: Buyer[] = cohorts
    .map((c) => {
      const funds = bal(ledger, `${c.id}:money`) + room(c);
      return {
        id: c.id,
        money: share >= 100 ? Infinity : Math.floor(funds / (1 - share / 100)),
        need: workingAge(c) ? Math.floor(c.population * ENROLL_SHARE) : 0,
        maxWtp: bal(ledger, `${c.id}:money`) < wantsUnits(c) * line.ask ? borrowerWtp(def.maxWtp, rateOf(lender())) : def.maxWtp,
      };
    })
    .filter((b) => b.need > 0);
  const auction = clearAuction(buyers, supply, askFor(line, line.batches));
  const price = applyMarkup(auction.price, markups.education);
  const subsidyPerUnit = Math.floor((price * share) / 100);
  const ownPerUnit = price - subsidyPerUnit;

  let sold = 0;
  let publicSpending = 0;
  let tuitionPaid = 0;
  const students: Record<string, number> = {};
  for (const [cohortId, wanted] of Object.entries(auction.fills)) {
    const c = cohorts.find((x) => x.id === cohortId)!;
    const cash = bal(ledger, `${c.id}:money`);
    const affordable = ownPerUnit === 0 ? wanted : Math.floor((cash + room(c)) / ownPerUnit);
    const fundable = subsidyPerUnit === 0 ? wanted : Math.floor(bal(ledger, "treasury:money") / subsidyPerUnit);
    const units = Math.min(wanted, affordable, fundable);
    if (units <= 0) continue;
    const own = units * ownPerUnit;
    const subsidy = units * subsidyPerUnit;
    if (subsidy > 0) {
      apply({
        type: "publicFunding",
        entries: [
          { account: "treasury:equity", debit: subsidy },
          { account: "treasury:money", credit: subsidy },
          { account: seller.money, debit: subsidy },
          { account: seller.equity, credit: subsidy },
        ],
      });
    }
    if (own > cash) {
      const borrow = own - cash;
      const gov = lender() === "gov";
      const loan = educationAccounts(c.id)[gov ? "govLoan" : "bankLoan"];
      apply({
        type: gov ? "governmentTuitionLoan" : "tuitionLoan",
        entries: [
          { account: gov ? "treasury:loansReceivable" : "bank:loansReceivable", debit: borrow },
          gov ? { account: "treasury:money", credit: borrow } : { account: "bank:depositsIssued", credit: borrow },
          { account: `${c.id}:money`, debit: borrow },
          { account: loan, credit: borrow },
        ],
      });
    }
    if (own > 0) {
      apply({
        type: "sale",
        entries: [
          { account: `${c.id}:equity`, debit: own },
          { account: `${c.id}:money`, credit: own },
          { account: seller.money, debit: own },
          { account: seller.equity, credit: own },
        ],
      });
    }
    sold += units;
    publicSpending += subsidy;
    tuitionPaid += own;
    students[c.id] = units;
  }

  // The Industry also sells education to other Industries, so households add to what it already sold this Tick.
  const updated = {
    ...line,
    batches: take(line.batches, sold),
    // The ask never climbs past what anyone would pay, or it would price out the Industries that buy education too.
    ask: Math.min(def.maxWtp, nextAsk(industry, line, line.sold + sold, supply + line.sold, auction.price)),
    sold: line.sold + sold,
    demand: line.demand + auction.demand,
    price: sold > 0 ? price : line.price,
  };
  const nextIndustry = {
    ...industry,
    revenue: industry.revenue + sold * price,
    lines: industry.lines.map((l, i) => (i === lineIndex ? updated : l)),
  };
  return {
    ledger,
    industries: industries.map((i, n) => (n === index ? nextIndustry : i)),
    cohorts: cohorts.map((c) => {
      const n = students[c.id] ?? 0;
      return { ...c, students: n, education: Math.min(100, c.education + (c.population > 0 ? (STUDY_GAIN * n) / c.population : 0)) };
    }),
    events,
    demand: auction.demand,
    publicSpending,
    tuitionPaid,
  };
}

/** The Treasury pays its Public Funding Share of the healthcare the Industry sold this Tick, on top of the price buyers paid. */
export function fundHealthcare(
  ledger: Ledger,
  industries: Industry[],
  share: number,
  tick: number,
): { ledger: Ledger; industries: Industry[]; events: MoneyEvent[]; paid: number } {
  const industry = industries.find((i) => i.id === EDUCATION_INDUSTRY);
  const line = industry?.lines.find((l) => l.productId === "healthcare");
  if (!industry || !line || share <= 0) return { ledger, industries, events: [], paid: 0 };
  const amount = Math.min(Math.floor((line.sold * line.price * share) / 100), bal(ledger, "treasury:money"));
  if (amount <= 0) return { ledger, industries, events: [], paid: 0 };
  const acct = industryAccounts(industry);
  const result = post(
    ledger,
    {
      type: "publicFunding",
      entries: [
        { account: "treasury:equity", debit: amount },
        { account: "treasury:money", credit: amount },
        { account: acct.money, debit: amount },
        { account: acct.equity, credit: amount },
      ],
    },
    tick,
  );
  return {
    ledger: result.ledger,
    industries: industries.map((i) => (i === industry ? { ...i, revenue: i.revenue + amount } : i)),
    events: result.event ? [result.event] : [],
    paid: amount,
  };
}
