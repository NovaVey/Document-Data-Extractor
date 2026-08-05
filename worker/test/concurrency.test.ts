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

import { resolveWorkerConcurrency, DEFAULT_WORKER_CONCURRENCY } from "../src/concurrency.js";

describe("resolveWorkerConcurrency", () => {
  const ORIGINAL_ENV = process.env.WORKER_CONCURRENCY;

  beforeEach(() => {
    state.capturedMessages = [];
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.WORKER_CONCURRENCY;
    } else {
      process.env.WORKER_CONCURRENCY = ORIGINAL_ENV;
    }
  });

  it("uses the documented default (1 — unchanged behavior) when unset", () => {
    delete process.env.WORKER_CONCURRENCY;
    expect(resolveWorkerConcurrency()).toBe(DEFAULT_WORKER_CONCURRENCY);
    expect(DEFAULT_WORKER_CONCURRENCY).toBe(1);
    expect(state.capturedMessages).toHaveLength(0);
  });

  it("uses the documented default when set to an empty string", () => {
    process.env.WORKER_CONCURRENCY = "";
    expect(resolveWorkerConcurrency()).toBe(DEFAULT_WORKER_CONCURRENCY);
    expect(state.capturedMessages).toHaveLength(0);
  });

  it("respects a valid override", () => {
    process.env.WORKER_CONCURRENCY = "5";
    expect(resolveWorkerConcurrency()).toBe(5);
    expect(state.capturedMessages).toHaveLength(0);
  });

  it("falls back to the default and reports a warning for a non-numeric override", () => {
    process.env.WORKER_CONCURRENCY = "3O"; // letter O, not zero — the realistic typo
    expect(resolveWorkerConcurrency()).toBe(DEFAULT_WORKER_CONCURRENCY);
    expect(state.capturedMessages).toHaveLength(1);
    expect(state.capturedMessages[0].message).toContain("WORKER_CONCURRENCY");
    expect(state.capturedMessages[0].level).toBe("warning");
  });

  it("rejects a non-integer (fractional lanes make no sense) as malformed", () => {
    process.env.WORKER_CONCURRENCY = "2.5";
    expect(resolveWorkerConcurrency()).toBe(DEFAULT_WORKER_CONCURRENCY);
    expect(state.capturedMessages).toHaveLength(1);
  });

  it("rejects zero and negative values instead of running with no/negative lanes", () => {
    process.env.WORKER_CONCURRENCY = "0";
    expect(resolveWorkerConcurrency()).toBe(DEFAULT_WORKER_CONCURRENCY);
    expect(state.capturedMessages).toHaveLength(1);

    state.capturedMessages = [];
    process.env.WORKER_CONCURRENCY = "-1";
    expect(resolveWorkerConcurrency()).toBe(DEFAULT_WORKER_CONCURRENCY);
    expect(state.capturedMessages).toHaveLength(1);
  });

  it("treats a whitespace-only override the same as unset, not as invalid", () => {
    process.env.WORKER_CONCURRENCY = "   ";
    expect(resolveWorkerConcurrency()).toBe(DEFAULT_WORKER_CONCURRENCY);
    expect(state.capturedMessages).toHaveLength(0);
  });
});
