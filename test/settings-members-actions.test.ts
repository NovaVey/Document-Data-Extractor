import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chainable } from "./helpers/supabase-mock";

// Medium-priority audit finding: inviteMember() (named explicitly) had no
// direct unit-test coverage. removeMember()/updateMemberRole() (added in
// this same session's high-priority batch, after the audit ran) are
// included too — real conditional logic with no coverage either. Also
// exercises the low-priority email-enumeration fix (inviteMember() no
// longer forwards the Auth API's raw error message).
const state = vi.hoisted(() => ({
  // Reassigned per-test with just enough of the real supabase-js clients'
  // shape for each scenario, not the full client surface.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseMock: {} as any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminMock: {} as any,
  membershipMock: null as { orgId: string; role: "owner" | "member" } | null,
  checkRateLimitMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => state.supabaseMock,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => state.adminMock,
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

import { inviteMember, removeMember, updateMemberRole } from "../src/app/settings/members/actions";

const NOT_OWNER_MEMBER = { orgId: "org-1", role: "member" as const };
const OWNER = { orgId: "org-1", role: "owner" as const };

beforeEach(() => {
  state.membershipMock = OWNER;
  state.checkRateLimitMock.mockReset().mockResolvedValue(true);
  state.revalidatePathMock.mockReset();
  state.supabaseMock = {};
  state.adminMock = {};
  vi.stubEnv("SITE_URL", "https://example.com");
  vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("inviteMember", () => {
  it("rejects a non-owner", async () => {
    state.membershipMock = NOT_OWNER_MEMBER;

    const result = await inviteMember("new@example.com", "member");

    expect(result).toEqual({ error: "Only an organization owner can manage members." });
  });

  it("rejects an invalid role", async () => {
    const result = await inviteMember("new@example.com", "superadmin" as never);
    expect(result).toEqual({ error: "Invalid role." });
  });

  it("rejects an email with no @", async () => {
    const result = await inviteMember("not-an-email", "member");
    expect(result).toEqual({ error: "Enter a valid email address." });
  });

  it("refuses to send when SITE_URL and RAILWAY_PUBLIC_DOMAIN are both unset", async () => {
    vi.stubEnv("SITE_URL", "");
    vi.stubEnv("RAILWAY_PUBLIC_DOMAIN", "");

    const result = await inviteMember("new@example.com", "member");

    expect(result?.error).toContain("SITE_URL is unset");
  });

  it("invites with the org id and chosen role in the user metadata", async () => {
    const inviteUserByEmailMock = vi.fn(async () => ({ error: null }));
    state.adminMock = { auth: { admin: { inviteUserByEmail: inviteUserByEmailMock } } };

    const result = await inviteMember("new@example.com", "owner");

    expect(result).toBeUndefined();
    expect(inviteUserByEmailMock).toHaveBeenCalledWith(
      "new@example.com",
      expect.objectContaining({
        data: { invited_org_id: "org-1", invited_role: "owner" },
        redirectTo: "https://example.com/invite/accept",
      }),
    );
    expect(state.revalidatePathMock).toHaveBeenCalledWith("/settings/members");
  });

  it("never forwards the Auth API's raw error message (email-enumeration fix)", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    state.adminMock = {
      auth: {
        admin: {
          inviteUserByEmail: async () => ({ error: { message: "User already registered" } }),
        },
      },
    };

    const result = await inviteMember("existing@example.com", "member");

    expect(result?.error).not.toContain("already registered");
    expect(result?.error).toContain("Couldn't send this invite");
    // The real reason is still logged server-side for diagnosing a genuine
    // outage -- only the caller-facing text is generic.
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("already registered"));
  });
});

describe("removeMember", () => {
  it("treats zero rows deleted (last-owner RLS rejection) as a real error", async () => {
    state.adminMock = {
      auth: {
        admin: { getUserById: async () => ({ data: { user: { email_confirmed_at: null } } }) },
      },
    };
    state.supabaseMock = {
      from: () => ({ delete: () => chainable({ data: null, error: null }) }),
    };

    const result = await removeMember("user-1");

    expect(result?.error).toContain("leave the organization with no owner");
  });

  it("cleans up the orphaned auth user for a still-pending invite", async () => {
    const deleteUserMock = vi.fn(async () => ({ error: null }));
    state.adminMock = {
      auth: {
        admin: {
          getUserById: async () => ({ data: { user: { email_confirmed_at: null } } }),
          deleteUser: deleteUserMock,
        },
      },
    };
    state.supabaseMock = {
      from: () => ({ delete: () => chainable({ data: { id: "membership-1" }, error: null }) }),
    };

    const result = await removeMember("user-1");

    expect(result).toBeUndefined();
    expect(deleteUserMock).toHaveBeenCalledWith("user-1");
  });

  it("keeps the auth account for an active (already-confirmed) member", async () => {
    const deleteUserMock = vi.fn(async () => ({ error: null }));
    state.adminMock = {
      auth: {
        admin: {
          getUserById: async () => ({
            data: { user: { email_confirmed_at: "2026-01-01T00:00:00Z" } },
          }),
          deleteUser: deleteUserMock,
        },
      },
    };
    state.supabaseMock = {
      from: () => ({ delete: () => chainable({ data: { id: "membership-1" }, error: null }) }),
    };

    await removeMember("user-1");

    expect(deleteUserMock).not.toHaveBeenCalled();
  });
});

describe("updateMemberRole", () => {
  it("rejects an invalid role before touching the database", async () => {
    const result = await updateMemberRole("user-1", "superadmin" as never);
    expect(result).toEqual({ error: "Invalid role." });
  });

  it("treats zero rows updated (last-owner RLS rejection) as a real error", async () => {
    state.supabaseMock = {
      from: () => ({ update: () => chainable({ data: null, error: null }) }),
    };

    const result = await updateMemberRole("user-1", "member");

    expect(result?.error).toContain("leave the organization with no owner");
  });

  it("succeeds and revalidates the members page", async () => {
    state.supabaseMock = {
      from: () => ({ update: () => chainable({ data: { id: "membership-1" }, error: null }) }),
    };

    const result = await updateMemberRole("user-1", "owner");

    expect(result).toBeUndefined();
    expect(state.revalidatePathMock).toHaveBeenCalledWith("/settings/members");
  });
});
