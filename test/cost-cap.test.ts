import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveDailyCostCapCents } from "../src/lib/documents/cost-cap.js";

// Medium-priority audit finding: this used to be a bare exported constant,
// always wrong once a deployment overrode the real (worker-enforced) cap
// via DAILY_COST_CAP_CENTS — now mirrors resolveReviewConfidenceThreshold()'s
// shape (test/review-threshold.test.ts) exactly, so it gets the same
// coverage for the same reason.
describe("resolveDailyCostCapCents", () => {
  const ORIGINAL_ENV = process.env.DAILY_COST_CAP_CENTS;

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.DAILY_COST_CAP_CENTS;
    } else {
      process.env.DAILY_COST_CAP_CENTS = ORIGINAL_ENV;
    }
    vi.restoreAllMocks();
  });

  it("uses the documented default (500) when unset", () => {
    delete process.env.DAILY_COST_CAP_CENTS;
    expect(resolveDailyCostCapCents()).toBe(500);
  });

  it("respects a valid override, matching what the worker/database would enforce", () => {
    process.env.DAILY_COST_CAP_CENTS = "1000";
    expect(resolveDailyCostCapCents()).toBe(1000);
  });

  it("falls back to the default and logs an error for a malformed override", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.DAILY_COST_CAP_CENTS = "50O"; // letter O, not zero
    expect(resolveDailyCostCapCents()).toBe(500);
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(errorSpy.mock.calls[0][0]).toContain("DAILY_COST_CAP_CENTS");
  });

  it("treats a whitespace-only override the same as unset, not as invalid", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.DAILY_COST_CAP_CENTS = "   ";
    expect(resolveDailyCostCapCents()).toBe(500);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
