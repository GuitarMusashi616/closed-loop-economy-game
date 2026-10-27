import { describe, expect, it } from "vitest";
import type { Command, TechnologyView } from "../sim";
import { availableToSpend, describeOrder, compact, gaugeLevel, techColumns, unlockables } from "./game";

describe("compact", () => {
  it("leaves small numbers whole and abbreviates large ones", () => {
    expect(compact(0)).toBe("0");
    expect(compact(999)).toBe("999");
    expect(compact(1500)).toBe("1.5K");
    expect(compact(2_000_000)).toBe("2M");
    expect(compact(-12_345)).toBe("-12.3K");
    expect(compact(3.4e9)).toBe("3.4B");
  });
});

describe("gaugeLevel", () => {
  it("rates a good-when-high stat", () => {
    expect(gaugeLevel(90, "high")).toBe("good");
    expect(gaugeLevel(50, "high")).toBe("warn");
    expect(gaugeLevel(10, "high")).toBe("bad");
  });
  it("rates a good-when-low stat", () => {
    expect(gaugeLevel(5, "low")).toBe("good");
    expect(gaugeLevel(40, "low")).toBe("warn");
    expect(gaugeLevel(80, "low")).toBe("bad");
  });
});

const tech = (id: string, requires: string[]): TechnologyView =>
  ({ id, name: id, branch: "food", cost: 1, requires, unlocks: { products: [], industries: [] }, progress: 0, status: "locked" }) as TechnologyView;

describe("techColumns", () => {
  it("places each Technology one column right of its deepest prerequisite", () => {
    const columns = techColumns([tech("c", ["a", "b"]), tech("a", []), tech("b", ["a"])]);
    expect(columns.map((col) => col.map((t) => t.id))).toEqual([["a"], ["b"], ["c"]]);
  });
});

describe("unlockables", () => {
  it("lists each stage with its opening Day and whether it is open", () => {
    const list = unlockables({ basics: true, taxes: false, policyRate: false }, 4);
    expect(list.map((u) => [u.id, u.open])).toEqual([["basics", true], ["taxes", false], ["policyRate", false]]);
    expect(list[1]!.daysLeft).toBe(6);
    expect(list[0]!.daysLeft).toBe(0);
  });
});

describe("availableToSpend", () => {
  it("counts queued Monetization in and queued Grants and Loans out", () => {
    const queued: Command[] = [
      { type: "monetize", amount: 500 },
      { type: "grant", cohortId: "cohort-0", amount: 200 },
      { type: "industryLoan", industryId: "agriculture", amount: 100 },
      { type: "setPolicyRate", rate: 0.03 },
    ];
    expect(availableToSpend(1000, queued)).toBe(1200);
    expect(availableToSpend(0, [])).toBe(0);
  });
});

describe("describeOrder", () => {
  it("names a queued order", () => {
    expect(describeOrder({ type: "monetize", amount: 1500 })).toBe("Monetize 1.5K");
    expect(describeOrder({ type: "setPolicyRate", rate: 0.03 })).toBe("Policy Rate 3.0%");
  });
});
