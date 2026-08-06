import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chainable } from "./helpers/supabase-mock";

// Medium-priority audit finding: no Server Action with real conditional
// logic had direct unit-test coverage — saveCorrection() and
// approveDocument() named specifically. Mocked at the module boundary
// (the Supabase client, rate limiting, Next's cache/navigation), same
// shape as upload-form.test.tsx and review-panel.test.tsx, so these
// exercise the actions' own branching (not-signed-in, rate-limited, error
// mapping) rather than a reimplementation of it.
const state = vi.hoisted(() => ({
  // Reassigned per-test with just enough of the real supabase-js client's
  // shape for each scenario, not the full client surface.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseMock: {} as any,
  checkRateLimitMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.supabaseMock,
}));

vi.mock("@/lib/rate-limit/check", () => ({
  checkRateLimit: (...args: unknown[]) => state.checkRateLimitMock(...args),
  RATE_LIMIT_MESSAGE: "Too many requests. Please try again shortly.",
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => state.revalidatePathMock(...args),
}));

import { saveCorrection, approveDocument } from "../src/app/documents/[id]/actions";

beforeEach(() => {
  state.checkRateLimitMock.mockReset().mockResolvedValue(true);
  state.revalidatePathMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("saveCorrection", () => {
  it("returns an error without touching the database when no user is signed in", async () => {
    state.supabaseMock = {
      auth: { getUser: async () => ({ data: { user: null } }) },
    };

    const result = await saveCorrection("doc-1", "invoice_number", "INV-002");

    expect(result).toEqual({ error: "Not signed in" });
    expect(state.checkRateLimitMock).not.toHaveBeenCalled();
  });

  it("returns the rate-limit message once the caller is over budget", async () => {
    state.supabaseMock = {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    };
    state.checkRateLimitMock.mockResolvedValue(false);

    const result = await saveCorrection("doc-1", "invoice_number", "INV-002");

    expect(result).toEqual({ error: "Too many requests. Please try again shortly." });
  });

  it("saves the correction, attributing it to the signed-in user, and revalidates the page", async () => {
    const updateMock = vi.fn(() => chainable({ error: null }));
    state.supabaseMock = {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: (table: string) => {
        expect(table).toBe("extracted_fields");
        return { update: updateMock };
      },
    };

    const result = await saveCorrection("doc-1", "invoice_number", "INV-002");

    expect(result).toBeUndefined();
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        was_corrected: true,
        corrected_value: "INV-002",
        corrected_by: "user-1",
      }),
    );
    expect(state.revalidatePathMock).toHaveBeenCalledWith("/documents/doc-1");
  });

  it("surfaces a friendly message instead of a raw Postgres error on failure", async () => {
    state.supabaseMock = {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      // A code with no specific friendlyDbError() mapping falls through to
      // this action's own operation-specific fallback text -- a mapped
      // code (e.g. 42501) is friendlyDbError()'s own concern, already
      // covered by that helper's own tests, not this action's.
      from: () => ({
        update: () => chainable({ error: { code: "99999", message: "raw unmapped error" } }),
      }),
    };

    const result = await saveCorrection("doc-1", "invoice_number", "INV-002");

    expect(result?.error).not.toBe("raw unmapped error");
    expect(result?.error).toContain("Couldn't save your correction");
  });
});

describe("approveDocument", () => {
  it("returns the rate-limit message once the caller is over budget", async () => {
    state.supabaseMock = {};
    state.checkRateLimitMock.mockResolvedValue(false);

    const result = await approveDocument("doc-1");

    expect(result).toEqual({ error: "Too many requests. Please try again shortly." });
  });

  it("calls the approve_document RPC and passes its own error message through verbatim", async () => {
    const rpcMock = vi.fn(async () => ({ error: { message: "2 field(s) still need review" } }));
    state.supabaseMock = { rpc: rpcMock };

    const result = await approveDocument("doc-1");

    expect(rpcMock).toHaveBeenCalledWith(
      "approve_document",
      expect.objectContaining({ p_document_id: "doc-1" }),
    );
    // Not routed through friendlyDbError -- approve_document()'s own
    // hand-authored review-gate message is meant to reach the reviewer
    // as-is, unlike a raw Postgres constraint error.
    expect(result).toEqual({ error: "2 field(s) still need review" });
  });

  it("revalidates both the document and documents-list pages on success", async () => {
    state.supabaseMock = { rpc: async () => ({ error: null }) };

    const result = await approveDocument("doc-7");

    expect(result).toBeUndefined();
    expect(state.revalidatePathMock).toHaveBeenCalledWith("/documents/doc-7");
    expect(state.revalidatePathMock).toHaveBeenCalledWith("/documents");
  });
});
