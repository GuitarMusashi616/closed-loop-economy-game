import type { ResearchView, TechnologyView } from "../sim";

const BRANCHES: { id: TechnologyView["branch"]; name: string }[] = [
  { id: "food", name: "Food" },
  { id: "materials-energy", name: "Materials and Energy" },
  { id: "industry", name: "Industry" },
  { id: "society", name: "Society" },
];

/** The Technology tree by branch, with progress, and the controls for choosing the active Technologies. */
export function Research({ research, onChoose }: { research: ResearchView; onChoose: (technologyIds: string[]) => void }) {
  const name = (id: string) => research.technologies.find((t) => t.id === id)?.name ?? id;
  const toggle = (t: TechnologyView) =>
    onChoose(t.status === "active" ? research.active.filter((id) => id !== t.id) : [...research.active, t.id]);
  return (
    <section>
      <h2>Research</h2>
      <p>
        Active {research.active.length}/{research.slots} slots · {research.scientists.toFixed(0)} scientists at productivity{" "}
        {research.productivity.toFixed(2)} · {research.pointsLastTick.toFixed(1)} points last Tick. The Treasury pays the Research Labs{" "}
        {research.contractPrice} per point (up to {research.contractUnits} a Tick) while a Technology is active.
      </p>
      {BRANCHES.map((branch) => (
        <div key={branch.id}>
          <h3>{branch.name}</h3>
          <table>
            <thead>
              <tr>
                <th align="left">Technology</th>
                <th align="left">Needs</th>
                <th align="right">Progress</th>
                <th align="left">Unlocks</th>
                <th align="left">Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {research.technologies
                .filter((t) => t.branch === branch.id)
                .map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td>{t.requires.map(name).join(", ") || "-"}</td>
                    <td align="right">
                      {Math.floor(t.progress)} / {t.cost}
                    </td>
                    <td>
                      {[...t.unlocks.products, ...t.unlocks.industries, ...(t.bonus?.slots ? [`${t.bonus.slots} Research slot`] : []), ...Object.entries(t.bonus?.yield ?? {}).map(([industry, share]) => `+${Math.round(share * 100)}% ${industry} output`)].join(", ") || "-"}
                    </td>
                    <td>{t.status}</td>
                    <td>
                      {(t.status === "available" || t.status === "active") && (
                        <button onClick={() => toggle(t)}>{t.status === "active" ? "Stop" : "Research"}</button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
