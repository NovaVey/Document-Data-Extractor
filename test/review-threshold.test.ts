import { afterEach, describe, expect, it, vi } from "vitest";
import {
  needsAttention,
  resolveReviewConfidenceThreshold,
  REVIEW_CONFIDENCE_THRESHOLD,
} from "../src/lib/review/threshold.js";

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

  it("respects an explicit threshold override instead of the module default", () => {
    expect(needsAttention(0.92, 0.95)).toBe(true); // below the stricter custom threshold
    expect(needsAttention(0.92, 0.9)).toBe(false); // above the default-sized threshold
  });
});

describe("resolveReviewConfidenceThreshold", () => {
  const ORIGINAL_ENV = process.env.REVIEW_CONFIDENCE_THRESHOLD;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.REVIEW_CONFIDENCE_THRESHOLD;
    } else {
      process.env.REVIEW_CONFIDENCE_THRESHOLD = ORIGINAL_ENV;
    }
    vi.restoreAllMocks();
  });

  it("uses the documented default when unset", () => {
    delete process.env.REVIEW_CONFIDENCE_THRESHOLD;
    expect(resolveReviewConfidenceThreshold()).toBe(REVIEW_CONFIDENCE_THRESHOLD);
  });

  it("respects a valid override", () => {
    process.env.REVIEW_CONFIDENCE_THRESHOLD = "0.95";
    expect(resolveReviewConfidenceThreshold()).toBe(0.95);
  });

  it("falls back to the default and logs an error for a malformed override", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.REVIEW_CONFIDENCE_THRESHOLD = "0.9O"; // letter O, not zero
    expect(resolveReviewConfidenceThreshold()).toBe(REVIEW_CONFIDENCE_THRESHOLD);
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy.mock.calls[0][0]).toContain("REVIEW_CONFIDENCE_THRESHOLD");
  });

  it("rejects an out-of-range value (<= 0, or > 1) as malformed rather than passing it through", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.REVIEW_CONFIDENCE_THRESHOLD = "0";
    expect(resolveReviewConfidenceThreshold()).toBe(REVIEW_CONFIDENCE_THRESHOLD);

    process.env.REVIEW_CONFIDENCE_THRESHOLD = "1.5";
    expect(resolveReviewConfidenceThreshold()).toBe(REVIEW_CONFIDENCE_THRESHOLD);

    expect(errorSpy).toHaveBeenCalledTimes(2);
  });

  it("treats a whitespace-only override the same as unset, not as invalid", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.REVIEW_CONFIDENCE_THRESHOLD = "   ";
    expect(resolveReviewConfidenceThreshold()).toBe(REVIEW_CONFIDENCE_THRESHOLD);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
