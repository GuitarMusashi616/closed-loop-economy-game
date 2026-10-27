import { useState } from "react";
import type { Citizen, Command } from "../sim";
import { Citizens } from "./Citizens";
import { Flows } from "./Flows";
import { Industries } from "./Industries";
import { Products } from "./Products";
import type { Snapshot, ToWorker } from "./protocol";

const TABS = [
  { id: "flow", label: "💸 Money flow" },
  { id: "markets", label: "📊 Industries and markets" },
  { id: "citizens", label: "👥 Citizens" },
  { id: "balance", label: "⚖️ Balance sheets" },
] as const;
type Tab = (typeof TABS)[number]["id"];

/** The deep-dive numbers behind the main screen, one tab each. */
export function Statistics({ snapshot, citizen, send, cmd }: { snapshot: Snapshot; citizen?: Citizen; send: (m: ToWorker) => void; cmd: (c: Command) => void }) {
  const [tab, setTab] = useState<Tab>("flow");
  const { stages, products, cohorts, durables, education, log, holders, sectoral, moneySupply } = snapshot;
  return (
    <div className="stats">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === tab} className={t.id === tab ? "tab on" : "tab"} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {tab === "flow" && (
        <Flows
          flows={snapshot.flows}
          window={snapshot.flowWindow}
          onWindow={(ticks) => send({ type: "setFlowWindow", ticks })}
          history={snapshot.history}
          notes={snapshot.notes}
          productNames={Object.fromEntries(products.map((p) => [p.id, p.name]))}
        />
      )}
      {tab === "markets" && (
        <>
          <Industries industries={snapshot.industries} />
          {!stages.taxes && <p className="locked">🔒 Markup / Discount unlocks with Taxes and Debt</p>}
          <fieldset disabled={!stages.taxes}>
            <Products products={products} wageMarkup={snapshot.wageMarkup} onMarkup={(target, percent) => cmd({ type: "setMarkup", target, percent })} />
          </fieldset>
        </>
      )}
      {tab === "citizens" && (
        <>
          <Citizens households={snapshot.households} summary={snapshot.summary} citizen={citizen} onZoom={(cohortId) => send({ type: "zoom", cohortId })} />
          <section>
            <h2>Houses and cars</h2>
            <table>
              <thead>
                <tr>
                  <th align="left">Cohort</th><th align="right">Houses</th><th align="right">House value</th>
                  <th align="right">Cars</th><th align="right">Car value</th><th align="right">Collateralised Loan</th>
                </tr>
              </thead>
              <tbody>
                {durables.map((d) => (
                  <tr key={d.cohortId}>
                    <td>{cohorts.find((c) => c.id === d.cohortId)?.name ?? d.cohortId}</td>
                    <td align="right">{d.houses.toLocaleString()}</td>
                    <td align="right">{d.houseValue.toLocaleString()}</td>
                    <td align="right">{d.cars.toLocaleString()}</td>
                    <td align="right">{d.carValue.toLocaleString()}</td>
                    <td align="right">{d.securedDebt.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h2>Education</h2>
            <p>
              Tuition {education.price} per study day · Tuition Loan rate {(education.tuitionRate * 100).toFixed(1)}%
              {education.governmentRate === null ? "" : `, Government ${(education.governmentRate * 100).toFixed(1)}%`} · Students {education.students.toLocaleString()} ·
              Tuition debt: Commercial Bank {education.debt.bank.toLocaleString()}, Government {education.debt.government.toLocaleString()} · Last Tick: students paid{" "}
              {education.tuitionPaid.toLocaleString()}.
            </p>
          </section>
        </>
      )}
      {tab === "balance" && (
        <section>
          <h2>Money supply: {moneySupply.toLocaleString()}</h2>
          <table>
            <thead><tr><th align="left">Holder</th><th align="right">Balance</th></tr></thead>
            <tbody>{holders.map((h) => <tr key={h.holder}><td>{h.holder}</td><td align="right">{h.balance.toLocaleString()}</td></tr>)}</tbody>
          </table>
          <h2>Sectoral Balance</h2>
          <table>
            <tbody>
              <tr><td>Government</td><td align="right">{sectoral.government.toLocaleString()}</td></tr>
              <tr><td>Households</td><td align="right">{sectoral.households.toLocaleString()}</td></tr>
              <tr><td>Industries</td><td align="right">{sectoral.industries.toLocaleString()}</td></tr>
              <tr><td>Commercial Banks</td><td align="right">{sectoral.commercialBanks.toLocaleString()}</td></tr>
            </tbody>
          </table>
          <h2>Money created and destroyed</h2>
          {log.length === 0 ? (
            <p>No money has been created or destroyed yet.</p>
          ) : (
            <ul>{[...log].reverse().map((e, i) => <li key={i}>Day {e.tick}: {e.amount.toLocaleString()} {e.direction} by {e.cause}</li>)}</ul>
          )}
        </section>
      )}
    </div>
  );
}
