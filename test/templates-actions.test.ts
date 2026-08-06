import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chainable } from "./helpers/supabase-mock";

// Medium-priority audit finding: createTemplate/updateTemplate/deleteTemplate
// (named explicitly) had no direct unit-test coverage. Mocked at the
// module boundary, same shape as documents-id-actions.test.ts.
const state = vi.hoisted(() => ({
  // Reassigned per-test with just enough of the real supabase-js client's
  // shape for each scenario, not the full client surface.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseMock: {} as any,
  membershipMock: null as { orgId: string; role: "owner" | "member" } | null,
  checkRateLimitMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.supabaseMock,
}));

vi.mock("@/lib/org", () => ({
  requireOwnerMembership: async (notAnOwnerMessage: string) => {
    if (!state.membershipMock) return { error: "No organization membership found" };
    if (state.membershipMock.role !== "owner") return { error: notAnOwnerMessage };
    return { membership: state.membershipMock };
  },
}));

vi.mock("@/lib/rate-limit/check", () => ({
  checkRateLimit: (...args: unknown[]) => state.checkRateLimitMock(...args),
  RATE_LIMIT_MESSAGE: "Too many requests. Please try again shortly.",
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => state.revalidatePathMock(...args),
}));

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => state.redirectMock(...args),
}));

import { createTemplate, updateTemplate, deleteTemplate } from "../src/app/templates/actions";

const VALID_FIELDS = [
  { key: "invoice_number", label: "Invoice Number", type: "text" as const, required: true },
];

beforeEach(() => {
  state.membershipMock = { orgId: "org-1", role: "owner" };
  state.checkRateLimitMock.mockReset().mockResolvedValue(true);
  state.revalidatePathMock.mockReset();
  state.redirectMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("createTemplate", () => {
  it("rejects invalid fields before ever touching the database or rate limiter", async () => {
    const result = await createTemplate("My Template", [
      { key: "", label: "", type: "text" as const, required: true },
    ]);

    expect(result?.error).toBeTruthy();
    expect(state.checkRateLimitMock).not.toHaveBeenCalled();
  });

  it("rejects a non-owner with the templates-specific message", async () => {
    state.membershipMock = { orgId: "org-1", role: "member" };

    const result = await createTemplate("My Template", VALID_FIELDS);

    expect(result).toEqual({ error: "Only an organization owner can manage templates." });
  });

  it("inserts scoped to the caller's org and redirects to the list on success", async () => {
    const insertMock = vi.fn(() => chainable({ error: null }));
    state.supabaseMock = {
      from: (table: string) => {
        expect(table).toBe("extraction_templates");
        return { insert: insertMock };
      },
    };

    await createTemplate("My Template", VALID_FIELDS);

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ org_id: "org-1", name: "My Template", fields: VALID_FIELDS }),
    );
    expect(state.redirectMock).toHaveBeenCalledWith("/templates");
  });
});

describe("updateTemplate", () => {
  it("treats an RLS-blocked update (zero rows matched) as a real error, not a silent no-op", async () => {
    state.supabaseMock = {
      from: () => ({ update: () => chainable({ data: null, error: null }) }),
    };

    const result = await updateTemplate("tmpl-1", "New Name", VALID_FIELDS);

    expect(result?.error).toContain("may not exist");
    expect(state.redirectMock).not.toHaveBeenCalled();
  });

  it("redirects on a genuine update", async () => {
    state.supabaseMock = {
      from: () => ({ update: () => chainable({ data: { id: "tmpl-1" }, error: null }) }),
    };

    await updateTemplate("tmpl-1", "New Name", VALID_FIELDS);

    expect(state.redirectMock).toHaveBeenCalledWith("/templates");
  });
});

describe("deleteTemplate", () => {
  it("gives a specific message for a foreign-key violation (template still in use)", async () => {
    state.supabaseMock = {
      from: () => ({
        delete: () => chainable({ error: { code: "23503", message: "fk violation" } }),
      }),
    };

    const result = await deleteTemplate("tmpl-1");

    expect(result).toEqual({
      error: "This template is used by existing documents and can't be deleted.",
    });
  });

  it("succeeds and revalidates the templates list", async () => {
    state.supabaseMock = {
      from: () => ({ delete: () => chainable({ data: { id: "tmpl-1" }, error: null }) }),
    };

    const result = await deleteTemplate("tmpl-1");

    expect(result).toBeUndefined();
    expect(state.revalidatePathMock).toHaveBeenCalledWith("/templates");
  });
});
