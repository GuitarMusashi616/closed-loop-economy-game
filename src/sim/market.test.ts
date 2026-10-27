import { describe, expect, it } from "vitest";
import { clearAuction, type Buyer } from "./market";

const buyer = (id: string, money: number, need = 100, maxWtp = 20): Buyer => ({ id, money, need, maxWtp });

describe("the call auction", () => {
  it("sells nothing when buyers have no money", () => {
    const result = clearAuction([buyer("a", 0)], 50, 5);
    expect(result.quantity).toBe(0);
    expect(result.fills).toEqual({});
  });

  it("trades at the seller's ask when supply exceeds demand at that price", () => {
    const result = clearAuction([buyer("a", 100)], 50, 10);
    expect(result.price).toBe(10);
    expect(result.quantity).toBe(10);
    expect(result.fills).toEqual({ a: 10 });
  });

  it("lets demand pull the price above the ask when supply is scarce", () => {
    const result = clearAuction([buyer("a", 10_000, 100, 20)], 10, 2);
    expect(result.quantity).toBe(10);
    expect(result.price).toBeGreaterThan(2);
  });

  it("never spends more than a buyer holds", () => {
    const result = clearAuction([buyer("a", 37), buyer("b", 5)], 1000, 3);
    expect((result.fills.a ?? 0) * result.price).toBeLessThanOrEqual(37);
    expect((result.fills.b ?? 0) * result.price).toBeLessThanOrEqual(5);
  });

  it("rations scarce supply across buyers without selling more than exists", () => {
    const result = clearAuction([buyer("a", 10_000), buyer("b", 10_000)], 7, 1);
    expect(result.quantity).toBe(7);
    expect((result.fills.a ?? 0) + (result.fills.b ?? 0)).toBe(7);
  });
});
