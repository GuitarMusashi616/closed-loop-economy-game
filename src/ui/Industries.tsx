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
            <th align="right">Grain stock</th>
            <th align="right">Price</th>
            <th align="right">Wage</th>
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
              <td align="right">{i.stock.toLocaleString()}</td>
              <td align="right">{i.price > 0 ? i.price.toLocaleString() : "–"}</td>
              <td align="right">{i.wage.toLocaleString()}</td>
              <td align="right">{i.headcount.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
