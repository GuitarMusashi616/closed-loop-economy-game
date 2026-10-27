import type { Citizen, CohortView, CountrySummary } from "../sim";

const fmt = (n: number) => n.toFixed(1);

export function Citizens({
  households,
  summary,
  citizen,
  onZoom,
}: {
  households: CohortView[];
  summary: CountrySummary;
  citizen?: Citizen;
  onZoom: (cohortId: string) => void;
}) {
  return (
    <section>
      <h2>Citizens</h2>
      <p>
        Country: {summary.population.toLocaleString()} citizens · health {fmt(summary.health)} · hunger {fmt(summary.hunger)} · thirst{" "}
        {fmt(summary.thirst)} · homelessness {(summary.homelessness * 100).toFixed(1)}% · education {fmt(summary.education)} · wealth{" "}
        {fmt(summary.wealth)} · {summary.deaths.toLocaleString()} died · {summary.emigrated.toLocaleString()} emigrated · {summary.immigrated.toLocaleString()} immigrated
      </p>
      <table>
        <thead>
          <tr>
            <th align="left">Household Cohort</th>
            <th align="right">Citizens</th>
            <th align="right">Health</th>
            <th align="right">Hunger</th>
            <th align="right">Thirst</th>
            <th align="right">Homeless</th>
            <th align="right">Education</th>
            <th align="right">Wealth</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {households.map((c) => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td align="right">{c.population.toLocaleString()}</td>
              <td align="right">{fmt(c.health)}</td>
              <td align="right">{fmt(c.hunger)}</td>
              <td align="right">{fmt(c.thirst)}</td>
              <td align="right">{(c.homelessness * 100).toFixed(1)}%</td>
              <td align="right">{fmt(c.education)}</td>
              <td align="right">{fmt(c.wealth)}</td>
              <td>
                <button disabled={c.population === 0} onClick={() => onZoom(c.id)}>Zoom</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {citizen && (
        <p>
          Citizen #{citizen.index.toLocaleString()} of {households.find((c) => c.id === citizen.cohortId)?.name}: health {fmt(citizen.health)},
          hunger {fmt(citizen.hunger)}, thirst {fmt(citizen.thirst)}, {citizen.homeless ? "homeless" : "housed"}, education{" "}
          {fmt(citizen.education)}, wealth {fmt(citizen.wealth)}
        </p>
      )}
    </section>
  );
}
