import { useState } from "react";
import type { ProductMarketView } from "../sim";

/** Supply, demand and price for every Product, with the player's Markup / Discount controls. */
export function Products({
  products,
  wageMarkup,
  onMarkup,
}: {
  products: ProductMarketView[];
  wageMarkup: number;
  onMarkup: (target: string, percent: number) => void;
}) {
  const [draft, setDraft] = useState<Record<string, number>>({});
  const control = (target: string, current: number) => (
    <>
      <input
        type="number"
        min={-99}
        step={5}
        style={{ width: "4em" }}
        value={draft[target] ?? current}
        onChange={(e) => setDraft({ ...draft, [target]: Number(e.target.value) })}
      />
      %{" "}
      <button onClick={() => onMarkup(target, draft[target] ?? current)}>Set</button>
    </>
  );
  return (
    <section>
      <h2>Products</h2>
      <table>
        <thead>
          <tr>
            <th align="left">Product</th>
            <th align="left">Tier</th>
            <th align="right">Supply</th>
            <th align="right">Demand</th>
            <th align="right">Sold</th>
            <th align="right">Price</th>
            <th align="right">Spoiled</th>
            <th align="left">Markup / Discount</th>
          </tr>
        </thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>{p.tier}</td>
              <td align="right">{p.supply.toLocaleString()}</td>
              <td align="right">{p.demand.toLocaleString()}</td>
              <td align="right">{p.sold.toLocaleString()}</td>
              <td align="right">{p.price > 0 ? p.price.toLocaleString() : "–"}</td>
              <td align="right">{p.spoiled.toLocaleString()}</td>
              <td>{control(p.id, p.markup)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>Wage Markup / Discount {control("wages", wageMarkup)}</p>
    </section>
  );
}
