import { describe, expect, it } from "vitest";
import { needsAttention, REVIEW_CONFIDENCE_THRESHOLD } from "../src/scoring/threshold.js";

describe("needsAttention", () => {
  it("does not flag a field at or above the threshold", () => {
    expect(needsAttention(REVIEW_CONFIDENCE_THRESHOLD)).toBe(false);
    expect(needsAttention(1)).toBe(false);
  });

  it("flags a field just below the threshold", () => {
    expect(needsAttention(REVIEW_CONFIDENCE_THRESHOLD - 0.01)).toBe(true);
  });

  it("flags a field forced to 0 by a failed validator, regardless of the threshold's exact value", () => {
    // This is the case item 8 already guarantees: any invalid/missing
    // field scores exactly 0, which is below any threshold worth choosing.
    expect(needsAttention(0)).toBe(true);
  });

  it("does not flag every observed confidence from the real ground-truth run (0.95-1.0)", () => {
    // Lowest confidence actually observed on a correct, validator-passing
    // field across all 10 ground-truth documents (see WORKFLOW.md decisions
    // log) was 0.95 — confirms the chosen threshold has real headroom
    // below the model's normal "confident and correct" range.
    for (const confidence of [0.95, 0.97, 0.98, 0.99, 1]) {
      expect(needsAttention(confidence)).toBe(false);
    }
  });
});
