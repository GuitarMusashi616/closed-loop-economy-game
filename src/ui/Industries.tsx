import { stockOf } from "../sim/industry";
import type { IndustryView } from "../sim";

export function Industries({ industries }: { industries: IndustryView[] }) {
  return (
    <section>
      <h2>Industries</h2>
      <table>
        <thead>
          <tr>
            <th align="left">Industry</th>
            <th align="right">Money</th>
            <th align="right">Loan owed</th>
            <th align="right">Equity</th>
            <th align="right">Gov stake</th>
            <th align="right">Food stock</th>
            <th align="right">Wage</th>
            <th align="right">Workers</th>
            <th align="right">Headcount</th>
          </tr>
        </thead>
        <tbody>
          {industries.map((i) => (
            <tr key={i.id}>
              <td>{i.name}{i.started ? "" : " (not started)"}</td>
              <td align="right">{i.money.toLocaleString()}</td>
              <td align="right">{i.loanOwed.toLocaleString()}</td>
              <td align="right">{i.equity.toLocaleString()}</td>
              <td align="right">{i.stake.toLocaleString()}</td>
              <td align="right">{i.lines.reduce((s, l) => s + stockOf(l), 0).toLocaleString()}</td>
              <td align="right">{i.wage.toLocaleString()}</td>
              <td align="right">{Math.round(i.workers).toLocaleString()}</td>
              <td align="right">{i.headcount.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
