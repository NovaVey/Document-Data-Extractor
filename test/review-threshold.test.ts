import { describe, expect, it } from "vitest";
import { needsAttention, REVIEW_CONFIDENCE_THRESHOLD } from "../src/lib/review/threshold.js";

// Mirrors worker/test/threshold.test.ts — this module is a deliberate
// duplicate of worker/src/scoring/threshold.ts (see the file's own
// comment), so it gets its own real coverage rather than being assumed
// identical to the worker's copy.
describe("needsAttention", () => {
  it("does not flag a field at or above the threshold", () => {
    expect(needsAttention(REVIEW_CONFIDENCE_THRESHOLD)).toBe(false);
    expect(needsAttention(1)).toBe(false);
  });

  it("flags a field just below the threshold", () => {
    expect(needsAttention(REVIEW_CONFIDENCE_THRESHOLD - 0.01)).toBe(true);
  });

  it("flags a field forced to 0 by a failed validator", () => {
    expect(needsAttention(0)).toBe(true);
  });
});
