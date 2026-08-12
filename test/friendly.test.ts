import { describe, expect, it } from "vitest";
import { friendlyDbError, friendlyStorageError } from "../src/lib/errors/friendly.js";

// friendlyDbError had zero direct test coverage before this file (only ever
// exercised indirectly through whichever Server Action called it) -- added
// here since friendlyStorageError, its Storage-error counterpart below,
// deliberately mirrors its "You don't have permission to do that." wording
// for the equivalent underlying failure, and that equivalence is worth
// asserting directly rather than trusting by inspection.
describe("friendlyDbError", () => {
  it("maps unique_violation (23505) to a friendly duplicate message", () => {
    expect(friendlyDbError({ code: "23505", message: "duplicate key value" }, "fallback")).toBe(
      "That already exists — it may have just been created by another request.",
    );
  });

  it("maps insufficient_privilege (42501) to a friendly permission message", () => {
    expect(
      friendlyDbError(
        { code: "42501", message: "permission denied for table documents" },
        "fallback",
      ),
    ).toBe("You don't have permission to do that.");
  });

  it("maps PostgREST's RLS code (PGRST301) the same as 42501", () => {
    expect(friendlyDbError({ code: "PGRST301", message: "JWT expired" }, "fallback")).toBe(
      "You don't have permission to do that.",
    );
  });

  it("falls back to the caller-supplied message for an unrecognized code", () => {
    expect(friendlyDbError({ code: "23503", message: "raw fk violation" }, "Couldn't save.")).toBe(
      "Couldn't save.",
    );
  });

  it("falls back for a missing code entirely (e.g. a network error)", () => {
    expect(friendlyDbError({ message: "fetch failed" }, "Couldn't save.")).toBe("Couldn't save.");
  });
});

// Caught live reviewing the deployed app: a real upload attempt against the
// read-only demo account surfaced the raw Postgres string
// "new row violates row-level security policy for table \"objects\"" with
// nothing else explaining it -- meaningless jargon to anyone hitting the
// same is_writable_org_member() rejection every other write path in this
// app already gives friendly text for via friendlyDbError's 42501 case.
describe("friendlyStorageError", () => {
  it("intercepts an RLS-blocked Storage write with the same wording friendlyDbError uses for 42501", () => {
    expect(
      friendlyStorageError('new row violates row-level security policy for table "objects"'),
    ).toBe("You don't have permission to do that.");
  });

  it("matches case-insensitively and regardless of the trailing table/policy-name suffix", () => {
    expect(friendlyStorageError("New Row Violates Row-Level Security Policy")).toBe(
      "You don't have permission to do that.",
    );
  });

  it("passes through a genuinely diagnosable Storage error unchanged", () => {
    expect(friendlyStorageError("The object exceeded the maximum allowed size")).toBe(
      "The object exceeded the maximum allowed size",
    );
  });

  it("passes through an unrelated message unchanged rather than guessing", () => {
    expect(friendlyStorageError("JWT expired")).toBe("JWT expired");
  });
});
