import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rpcArgs: null as Record<string, unknown> | null,
  rpcData: [] as unknown[],
  rpcError: null as { message: string } | null,
  capturedMessages: [] as { message: string; level: string }[],
}));

vi.mock("../src/supabase.js", () => ({
  supabase: {
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      state.rpcArgs = args;
      return { data: state.rpcData, error: state.rpcError };
    },
  },
}));

vi.mock("../src/sentry.js", () => ({
  Sentry: {
    captureMessage: (message: string, level: string) => {
      state.capturedMessages.push({ message, level });
    },
  },
}));

import { claimNextDocument } from "../src/claim.js";

const ORIGINAL_ENV = process.env.DAILY_COST_CAP_CENTS;

beforeEach(() => {
  state.rpcArgs = null;
  state.rpcData = [];
  state.rpcError = null;
  state.capturedMessages = [];
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.DAILY_COST_CAP_CENTS;
  } else {
    process.env.DAILY_COST_CAP_CENTS = ORIGINAL_ENV;
  }
});

describe("claimNextDocument — daily cost cap resolution", () => {
  it("uses the documented default when DAILY_COST_CAP_CENTS is unset", async () => {
    delete process.env.DAILY_COST_CAP_CENTS;
    await claimNextDocument();
    expect(state.rpcArgs?.daily_cost_cap_cents).toBe(500);
    expect(state.capturedMessages).toHaveLength(0);
  });

  it("uses the documented default when DAILY_COST_CAP_CENTS is an empty string", async () => {
    process.env.DAILY_COST_CAP_CENTS = "";
    await claimNextDocument();
    expect(state.rpcArgs?.daily_cost_cap_cents).toBe(500);
    expect(state.capturedMessages).toHaveLength(0);
  });

  it("respects a valid override", async () => {
    process.env.DAILY_COST_CAP_CENTS = "1200";
    await claimNextDocument();
    expect(state.rpcArgs?.daily_cost_cap_cents).toBe(1200);
    expect(state.capturedMessages).toHaveLength(0);
  });

  // This is the actual bug: Number("50O") (or any malformed value) is NaN,
  // and NaN serializes to JSON null over the wire — making the SQL cost-cap
  // comparison UNKNOWN for every row, silently halting the entire queue
  // for every org with no error surfaced anywhere. The fix must never let
  // NaN reach the RPC call.
  it("falls back to the default and reports a warning for a malformed override, instead of passing NaN through", async () => {
    process.env.DAILY_COST_CAP_CENTS = "50O"; // letter O, not zero — the realistic typo
    await claimNextDocument();

    expect(state.rpcArgs?.daily_cost_cap_cents).toBe(500);
    expect(Number.isNaN(state.rpcArgs?.daily_cost_cap_cents)).toBe(false);
    expect(state.capturedMessages).toHaveLength(1);
    expect(state.capturedMessages[0].message).toContain("DAILY_COST_CAP_CENTS");
    expect(state.capturedMessages[0].level).toBe("warning");
  });

  // Number(" ") is 0, not NaN — a naive isFinite-only guard would treat a
  // whitespace-only override as a "valid" cap of 0 instead of recognizing
  // it's not really configured at all. Trimmed-empty is treated the same
  // as unset: default, no warning (nothing was really typed).
  it("treats a whitespace-only override the same as unset, not as a valid 0", async () => {
    process.env.DAILY_COST_CAP_CENTS = "   ";
    await claimNextDocument();
    expect(state.rpcArgs?.daily_cost_cap_cents).toBe(500);
    expect(state.capturedMessages).toHaveLength(0);
  });
});
