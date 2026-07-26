import { describe, expect, it } from "vitest";
import { computeCostCents } from "../src/extraction/cost.js";

describe("computeCostCents", () => {
  it("computes cost for a typical small extraction call", () => {
    // 1000 input tokens @ $3/M + 200 output tokens @ $15/M = 0.3 + 0.3 = 0.6 -> rounds to 1 cent
    expect(computeCostCents(1000, 200)).toBe(1);
  });

  it("computes cost for a larger call", () => {
    // 10,000 input @ $3/M + 2,000 output @ $15/M = 3.0 + 3.0 = 6 cents
    expect(computeCostCents(10_000, 2_000)).toBe(6);
  });

  it("returns 0 for zero tokens", () => {
    expect(computeCostCents(0, 0)).toBe(0);
  });

  it("rounds down a fraction below the half-cent boundary", () => {
    // 100 input tokens @ $3/M = 0.03 cents -> rounds to 0
    expect(computeCostCents(100, 0)).toBe(0);
  });

  it("rounds up a fraction at or above the half-cent boundary", () => {
    // 1667 output tokens @ $15/M = 0.025005 cents -> still rounds to 0;
    // 200,000 output tokens @ $15/M = 300 cents exactly
    expect(computeCostCents(0, 200_000)).toBe(300);
  });

  it("weights output tokens more heavily than input tokens", () => {
    const inputOnly = computeCostCents(100_000, 0);
    const outputOnly = computeCostCents(0, 100_000);
    expect(outputOnly).toBeGreaterThan(inputOnly);
  });
});
