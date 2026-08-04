import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  capturedMessages: [] as { message: string; level: string }[],
}));

vi.mock("../src/sentry.js", () => ({
  Sentry: {
    captureMessage: (message: string, level: string) => {
      state.capturedMessages.push({ message, level });
    },
  },
}));

import {
  needsAttention,
  resolveReviewConfidenceThreshold,
  REVIEW_CONFIDENCE_THRESHOLD,
} from "../src/scoring/threshold.js";

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

  it("respects an explicit threshold override instead of the module default", () => {
    expect(needsAttention(0.92, 0.95)).toBe(true); // below the stricter custom threshold
    expect(needsAttention(0.92, 0.9)).toBe(false); // above the default-sized threshold
  });
});

describe("resolveReviewConfidenceThreshold", () => {
  const ORIGINAL_ENV = process.env.REVIEW_CONFIDENCE_THRESHOLD;

  beforeEach(() => {
    state.capturedMessages = [];
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.REVIEW_CONFIDENCE_THRESHOLD;
    } else {
      process.env.REVIEW_CONFIDENCE_THRESHOLD = ORIGINAL_ENV;
    }
  });

  it("uses the documented default when unset", () => {
    delete process.env.REVIEW_CONFIDENCE_THRESHOLD;
    expect(resolveReviewConfidenceThreshold()).toBe(REVIEW_CONFIDENCE_THRESHOLD);
    expect(state.capturedMessages).toHaveLength(0);
  });

  it("uses the documented default when set to an empty string", () => {
    process.env.REVIEW_CONFIDENCE_THRESHOLD = "";
    expect(resolveReviewConfidenceThreshold()).toBe(REVIEW_CONFIDENCE_THRESHOLD);
    expect(state.capturedMessages).toHaveLength(0);
  });

  it("respects a valid override", () => {
    process.env.REVIEW_CONFIDENCE_THRESHOLD = "0.95";
    expect(resolveReviewConfidenceThreshold()).toBe(0.95);
    expect(state.capturedMessages).toHaveLength(0);
  });

  it("falls back to the default and reports a warning for a malformed override", () => {
    process.env.REVIEW_CONFIDENCE_THRESHOLD = "0.9O"; // letter O, not zero
    expect(resolveReviewConfidenceThreshold()).toBe(REVIEW_CONFIDENCE_THRESHOLD);
    expect(state.capturedMessages).toHaveLength(1);
    expect(state.capturedMessages[0].message).toContain("REVIEW_CONFIDENCE_THRESHOLD");
    expect(state.capturedMessages[0].level).toBe("warning");
  });

  it("rejects an out-of-range value (<= 0, or > 1) as malformed rather than passing it through", () => {
    process.env.REVIEW_CONFIDENCE_THRESHOLD = "0";
    expect(resolveReviewConfidenceThreshold()).toBe(REVIEW_CONFIDENCE_THRESHOLD);
    expect(state.capturedMessages).toHaveLength(1);

    state.capturedMessages = [];
    process.env.REVIEW_CONFIDENCE_THRESHOLD = "1.5";
    expect(resolveReviewConfidenceThreshold()).toBe(REVIEW_CONFIDENCE_THRESHOLD);
    expect(state.capturedMessages).toHaveLength(1);
  });

  it("accepts exactly 1 as a valid (if extreme) threshold", () => {
    process.env.REVIEW_CONFIDENCE_THRESHOLD = "1";
    expect(resolveReviewConfidenceThreshold()).toBe(1);
    expect(state.capturedMessages).toHaveLength(0);
  });

  it("treats a whitespace-only override the same as unset, not as invalid", () => {
    process.env.REVIEW_CONFIDENCE_THRESHOLD = "   ";
    expect(resolveReviewConfidenceThreshold()).toBe(REVIEW_CONFIDENCE_THRESHOLD);
    expect(state.capturedMessages).toHaveLength(0);
  });
});
