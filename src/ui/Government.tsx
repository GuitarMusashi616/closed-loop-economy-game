import { useState, type ReactNode } from "react";
import { UNLOCK_TICK, type Command } from "../sim";
import type { Snapshot } from "./protocol";

const PERCENT = 100;
const DEFAULT_DEAL = 1000;

function Locked({ open, stage }: { open: boolean; stage: string }) {
  return open ? null : <p className="locked">🔒 Locked: {stage}</p>;
}

/** A number input and the button that acts on it, with optional extra controls between them. */
function NumberAction({ label, value, onChange, button, onSubmit, min = 1, max, step, children }: {
  label?: string;
  value: number;
  onChange: (value: number) => void;
  button: string;
  onSubmit: () => void;
  min?: number;
  max?: number;
  step?: number;
  children?: ReactNode;
}) {
  return (
    <div className="action">
      {label && <label>{label}</label>}
      <input type="number" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {children}
      <button className="btn small" onClick={onSubmit}>{button}</button>
    </div>
  );
}

/** Every Government lever: Treasury, taxes, debt, pensions, public services and the Central Bank. */
export function Government({ snapshot, cmd }: { snapshot: Snapshot; cmd: (command: Command) => void }) {
  const { cohorts, industries, stages, fiscal, debt, burdens, education, bank } = snapshot;
  const [monetize, setMonetize] = useState(DEFAULT_DEAL);
  const [grant, setGrant] = useState(100);
  const [loan, setLoan] = useState(DEFAULT_DEAL);
  const [convert, setConvert] = useState(DEFAULT_DEAL);
  const [debtAmount, setDebtAmount] = useState(DEFAULT_DEAL);
  const [grantCohort, setGrantCohort] = useState(cohorts[0]?.id ?? "");
  const [loanIndustry, setLoanIndustry] = useState(industries[0]?.id ?? "");
  const [convertIndustry, setConvertIndustry] = useState(industries[0]?.id ?? "");
  const [debtHolder, setDebtHolder] = useState("bank");
  const [incomeTax, setIncomeTax] = useState(fiscal.rates.income);
  const [corporateTax, setCorporateTax] = useState(fiscal.rates.corporate);
  const [pension, setPension] = useState(snapshot.pensionRate);
  const [healthcare, setHealthcare] = useState(0);
  const [schooling, setSchooling] = useState(0);
  const [policyRate, setPolicyRate] = useState(3);
  const [retailSpread, setRetailSpread] = useState(15);
  const industryPicker = (value: string, onChange: (id: string) => void) => (
    <select aria-label="Industry" value={value} onChange={(e) => onChange(e.target.value)}>
      {industries.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
    </select>
  );
  return (
    <div className="gov">
      <section className="panel">
        <h3>💰 Spending, loans and Monetization</h3>
        <NumberAction value={monetize} onChange={setMonetize} button="Monetize" onSubmit={() => cmd({ type: "monetize", amount: monetize })} />
        <NumberAction value={grant} onChange={setGrant} button="Grant" onSubmit={() => cmd({ type: "grant", cohortId: grantCohort, amount: grant })}>
          <select aria-label="Household Cohort" value={grantCohort} onChange={(e) => setGrantCohort(e.target.value)}>
            {cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </NumberAction>
        <NumberAction value={loan} onChange={setLoan} button="Industry Loan" onSubmit={() => cmd({ type: "industryLoan", industryId: loanIndustry, amount: loan })}>
          {industryPicker(loanIndustry, setLoanIndustry)}
        </NumberAction>
        <NumberAction value={convert} onChange={setConvert} button="Convert loan to Equity Stake" onSubmit={() => cmd({ type: "convertLoan", industryId: convertIndustry, amount: convert })}>
          {industryPicker(convertIndustry, setConvertIndustry)}
        </NumberAction>
      </section>

      <section className="panel">
        <h3>🧾 Taxes</h3>
        <Locked open={stages.taxes} stage={`taxes, Government debt and pensions unlock on Day ${UNLOCK_TICK.taxes}`} />
        <fieldset disabled={!stages.taxes}>
          <div className="action">
            <label>Income tax (%)</label>
            <input type="number" min={0} max={PERCENT} value={incomeTax} onChange={(e) => setIncomeTax(Number(e.target.value))} />
            <label>Corporate tax (%)</label>
            <input type="number" min={0} max={PERCENT} value={corporateTax} onChange={(e) => setCorporateTax(Number(e.target.value))} />
            <button className="btn small" onClick={() => cmd({ type: "setTaxRates", income: incomeTax, corporate: corporateTax })}>Set tax rates</button>
          </div>
        </fieldset>
        <p className="note">
          Rates {fiscal.rates.income}% income, {fiscal.rates.corporate}% corporate · Last Tick: income tax {fiscal.incomeTax.toLocaleString()}, corporate tax{" "}
          {fiscal.corporateTax.toLocaleString()}, dividends to Owner Cohort {fiscal.dividendsToOwners.toLocaleString()}, to Treasury{" "}
          {fiscal.dividendsToTreasury.toLocaleString()}, Household spending {fiscal.householdSpending.toLocaleString()}
        </p>
      </section>

      <section className="panel">
        <h3>📜 Government debt</h3>
        <fieldset disabled={!stages.taxes}>
          <NumberAction value={debtAmount} onChange={setDebtAmount} button="Sell debt" onSubmit={() => cmd({ type: "issueDebt", holder: debtHolder, amount: debtAmount })}>
            <select aria-label="Debt holder" value={debtHolder} onChange={(e) => setDebtHolder(e.target.value)}>
              <option value="bank">Commercial Bank</option>
              <option value="centralBank">Central Bank (retire only)</option>
              {cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button className="btn small" onClick={() => cmd({ type: "retireDebt", holder: debtHolder, amount: debtAmount })}>Retire debt</button>
          </NumberAction>
        </fieldset>
        <p className="note">
          Owed {debt.owed.toLocaleString()} · held by Central Bank {debt.centralBank.toLocaleString()}, Commercial Bank {debt.commercialBank.toLocaleString()}, Households {debt.households.toLocaleString()}
        </p>
        <table>
          <caption>Debt burdens (real = in starting prices; price index {burdens.priceIndex.toFixed(2)})</caption>
          <thead><tr><th align="left">Sector</th><th align="right">Nominal</th><th align="right">Real</th></tr></thead>
          <tbody>
            {(["government", "industries", "households"] as const).map((k) => (
              <tr key={k}><td>{k}</td><td align="right">{burdens[k].nominal.toLocaleString()}</td><td align="right">{Math.round(burdens[k].real).toLocaleString()}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h3>🏥 Pensions and public services</h3>
        <fieldset disabled={!stages.taxes}>
          <NumberAction label="Payout per retiree per Tick" min={0} step={0.05} value={pension} onChange={setPension} button="Set pension rate" onSubmit={() => cmd({ type: "setPensionRate", rate: pension })} />
          <NumberAction label="Healthcare Public Funding Share (%)" min={0} max={PERCENT} value={healthcare} onChange={setHealthcare} button="Set" onSubmit={() => cmd({ type: "setPublicFunding", service: "healthcare", percent: healthcare })} />
          <NumberAction label="Education Public Funding Share (%)" min={0} max={PERCENT} value={schooling} onChange={setSchooling} button="Set" onSubmit={() => cmd({ type: "setPublicFunding", service: "education", percent: schooling })} />
          <button className="btn small" onClick={() => cmd({ type: "setGovernmentEducationLoans", enabled: !education.governmentLoans })}>
            Government Tuition Loans: {education.governmentLoans ? "on (turn off)" : "off (turn on)"}
          </button>
        </fieldset>
        <p className="note">
          Pension {snapshot.pensionRate} per retiree per Tick (paid last Tick: {snapshot.pensionsPaid.toLocaleString()}) · Treasury paid {education.publicSpending.toLocaleString()} tuition and {education.healthcareFunding.toLocaleString()} healthcare last Tick.
        </p>
      </section>

      <section className="panel">
        <h3>🏦 Central Bank and Commercial Bank</h3>
        <Locked open={stages.policyRate} stage={`the Policy Rate unlocks on Day ${UNLOCK_TICK.policyRate}`} />
        <fieldset disabled={!stages.policyRate}>
          <NumberAction label="Policy Rate (%)" min={0} step={0.5} value={policyRate} onChange={setPolicyRate} button="Set Policy Rate" onSubmit={() => cmd({ type: "setPolicyRate", rate: policyRate / PERCENT })} />
          <NumberAction label="Retail spread (%)" min={0} step={0.5} value={retailSpread} onChange={setRetailSpread} button="Set spread" onSubmit={() => cmd({ type: "setSpreads", retail: retailSpread / PERCENT })} />
        </fieldset>
        <p className="note">
          Policy Rate {(bank.policyRate * 100).toFixed(1)}% · Retail Credit {(bank.rates.retail * 100).toFixed(1)}% · Collateralised {(bank.rates.collateralised * 100).toFixed(1)}% · Loans{" "}
          {bank.loans.toLocaleString()} · Deposits created {bank.deposits.toLocaleString()} · Equity {bank.equity.toLocaleString()} · {bank.lending ? "Lending" : "Not lending (too little equity)"}
        </p>
      </section>
    </div>
  );
}
