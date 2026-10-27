import type { LeverStages } from "../sim";
import { unlockables } from "./game";

/** What the player has opened so far, and what is still to come. */
export function Unlockables({ stages, tick }: { stages: LeverStages; tick: number }) {
  return (
    <div className="unlock-list">
      {unlockables(stages, tick).map((u) => (
        <article key={u.id} className={`unlock ${u.open ? "open" : "shut"}`}>
          <div className="unlock-icon" aria-hidden>{u.open ? "🔓" : "🔒"}</div>
          <div>
            <h4>{u.name}</h4>
            <p>{u.gives}</p>
            <strong>{u.open ? "Unlocked" : `Opens in ${u.daysLeft} day${u.daysLeft === 1 ? "" : "s"}`}</strong>
          </div>
        </article>
      ))}
    </div>
  );
}
