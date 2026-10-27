import { post, type Ledger, type MoneyEvent, type Transaction } from "./ledger";
import { clearAuction, type Buyer } from "./market";
import { applyMarkup, PRODUCTS, productDef } from "./products";
import { askFor, capacityWanted, industryAccounts, nextAsk, planFor, stockOf, take, type Industry, type ProductLine } from "./industry";

/** Share of an Industry's spare money it will put towards capital goods in one Tick. */
const CAPITAL_SHARE = 0.5;

interface Request {
  buyer: string;
  kind: "input" | "capital";
  productId: string;
  need: number;
  budget: number;
}

const balance = (ledger: Ledger, account: string) => ledger.balances[account] ?? 0;

/**
 * The input-output web for one Tick. Industries plan what to make, then buy the inputs they need
 * and the capital goods that replace their Capacity from each other, one call auction per Product.
 * What other Industries ask for sets what each Industry plans to make next.
 */
export function runSupplyWeb(
  industries: Industry[],
  ledger: Ledger,
  markups: Record<string, number>,
  tick: number,
): { industries: Industry[]; ledger: Ledger; events: MoneyEvent[] } {
  const events: MoneyEvent[] = [];
  const apply = (tx: Transaction) => {
    const result = post(ledger, tx, tick);
    ledger = result.ledger;
    if (result.event) events.push(result.event);
  };
  const byId = new Map<string, Industry>();
  for (const i of industries) {
    byId.set(i.id, i.started ? { ...i, revenue: 0, costs: 0, lines: i.lines.map((l) => ({ ...l, plan: planFor(i, l) })) } : i);
  }
  const running = () => [...byId.values()].filter((i) => i.started);

  // What each Industry wants to buy. Wages for next Tick are held back from the budget.
  const requests: Request[] = [];
  for (const industry of running()) {
    const spendable = Math.max(0, balance(ledger, industryAccounts(industry).money) - industry.targetHeadcount * industry.wage);
    const wanted: Request[] = [];
    const need: Record<string, number> = {};
    for (const line of industry.lines) {
      for (const [id, per] of Object.entries(line.inputs)) need[id] = (need[id] ?? 0) + line.plan * per;
    }
    for (const [productId, units] of Object.entries(need)) {
      const short = Math.ceil(units - (industry.inputStock[productId] ?? 0));
      if (short > 0) wanted.push({ buyer: industry.id, kind: "input", productId, need: short, budget: 0 });
    }
    const capPerGood = productDef(industry.capitalGood).capacityPerGood ?? 1;
    const gap = capacityWanted(industry) - industry.capacity;
    if (gap > 0) wanted.push({ buyer: industry.id, kind: "capital", productId: industry.capitalGood, need: Math.ceil(gap / capPerGood), budget: 0 });
    for (const r of wanted) {
      const share = Math.floor(spendable / wanted.length);
      r.budget = r.kind === "capital" ? Math.min(share, Math.floor(spendable * CAPITAL_SHARE)) : share;
    }
    requests.push(...wanted);
  }

  // What was asked for, price aside, sets how much each Industry expects to make next Tick.
  const asked: Record<string, number> = {};
  for (const r of requests) asked[r.productId] = (asked[r.productId] ?? 0) + r.need;
  for (const industry of running()) {
    byId.set(industry.id, {
      ...industry,
      lines: industry.lines.map((l) => (productDef(l.productId).household ? l : { ...l, expected: Math.ceil((l.expected + (asked[l.productId] ?? 0)) / 2) })),
    });
  }

  const sellers = new Set<string>();
  for (const def of PRODUCTS) {
    if (def.household) continue;
    const asks = running()
      .flatMap((i) => i.lines.filter((l) => l.productId === def.id).map((l) => ({ industry: i.id, ask: l.ask })))
      .sort((a, b) => a.ask - b.ask || a.industry.localeCompare(b.industry));
    const wants = requests.filter((r) => r.productId === def.id);
    for (const { industry: sellerId } of asks) {
      const seller = byId.get(sellerId)!;
      const line = seller.lines.find((l) => l.productId === def.id)!;
      const sellerAccounts = industryAccounts(seller);
      const supply = stockOf(line);
      const buyers: Buyer[] = wants
        .filter((r) => r.need > 0)
        .map((r) => ({
          id: `${r.buyer}:${r.kind}`,
          money: Math.min(r.budget, balance(ledger, industryAccounts(byId.get(r.buyer)!).money)),
          need: r.need,
          maxWtp: def.maxWtp,
        }));
      const auction = clearAuction(buyers, supply, askFor(line, line.batches));
      const price = applyMarkup(auction.price, markups[def.id]);
      let sold = 0;
      for (const [buyerKey, wanted] of Object.entries(auction.fills)) {
        const request = wants.find((r) => `${r.buyer}:${r.kind}` === buyerKey)!;
        const buyer = byId.get(request.buyer)!;
        const buyerAccounts = industryAccounts(buyer);
        const units = Math.min(wanted, Math.floor(balance(ledger, buyerAccounts.money) / price), Math.floor(request.budget / price));
        if (units <= 0) continue;
        const paid = units * price;
        apply({
          type: "sale",
          entries: [
            { account: buyerAccounts.equity, debit: paid },
            { account: buyerAccounts.money, credit: paid },
            { account: sellerAccounts.money, debit: paid },
            { account: sellerAccounts.equity, credit: paid },
          ],
        });
        sold += units;
        request.need -= units;
        request.budget -= paid;
        const bought = byId.get(request.buyer)!;
        byId.set(request.buyer, {
          ...bought,
          capacity: request.kind === "capital" ? bought.capacity + units * (def.capacityPerGood ?? 1) : bought.capacity,
          inputStock:
            request.kind === "input" ? { ...bought.inputStock, [def.id]: (bought.inputStock[def.id] ?? 0) + units } : bought.inputStock,
          costs: bought.costs + (request.kind === "input" ? paid : 0),
        });
      }
      const current = byId.get(sellerId)!;
      const updated: ProductLine = {
        ...current.lines.find((l) => l.productId === def.id)!,
        batches: take(line.batches, sold),
        ask: nextAsk(seller, line, sold, supply, auction.price),
        sold,
        demand: auction.demand,
        price: sold > 0 ? price : line.price,
      };
      byId.set(sellerId, {
        ...current,
        revenue: current.revenue + sold * (sold > 0 ? price : 0),
        lines: current.lines.map((l) => (l.productId === def.id ? updated : l)),
      });
      sellers.add(`${sellerId}:${def.id}`);
    }
  }

  // Lines nobody bid for or sold show no sales this Tick.
  const next = industries.map((original) => {
    const industry = byId.get(original.id)!;
    if (!industry.started) return industry;
    return {
      ...industry,
      lines: industry.lines.map((l) =>
        productDef(l.productId).household || sellers.has(`${industry.id}:${l.productId}`) ? l : { ...l, sold: 0, demand: 0 },
      ),
    };
  });
  return { industries: next, ledger, events };
}
