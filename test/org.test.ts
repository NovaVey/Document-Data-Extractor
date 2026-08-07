import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression coverage for a bug caught live (not by this suite -- there was
// no coverage of getCurrentMembership() at all before this): the query used
// to have no user_id filter, relying entirely on RLS to scope the result.
// That was safe when every org had exactly one member, but "org members can
// view memberships in their org" is deliberately org-wide (the Members page
// needs to see everyone), so once the invite flow let an org have 2+
// members, an unfiltered `.order(created_at).limit(1)` silently returned
// whichever row was created first for the ORG -- always the owner's, since
// the signup trigger creates that row first -- not the caller's own row.
// Every non-owner member of a multi-person org was treated as an owner.
const state = vi.hoisted(() => ({
  userId: "user-1" as string | null,
  membershipRow: null as { org_id: string; role: "owner" | "member" } | null,
  // Records the args .eq() was called with, so the test can assert the
  // query is actually scoped to the caller -- not just that the right
  // *result* comes back (a chain that ignores .eq() entirely and always
  // returns membershipRow would otherwise pass this test for the wrong
  // reason).
  eqCalls: [] as unknown[][],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.userId ? { id: state.userId } : null } }),
    },
    from: (table: string) => {
      if (table !== "memberships") throw new Error(`unexpected table: ${table}`);
      const chain = {
        select: () => chain,
        eq: (...args: unknown[]) => {
          state.eqCalls.push(args);
          return chain;
        },
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: state.membershipRow }),
      };
      return chain;
    },
  }),
}));

import { getCurrentMembership } from "../src/lib/org";

beforeEach(() => {
  state.userId = "user-1";
  state.membershipRow = { org_id: "org-1", role: "member" };
  state.eqCalls = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getCurrentMembership", () => {
  it("scopes the query to the signed-in user's own row", async () => {
    await getCurrentMembership();

    expect(state.eqCalls).toContainEqual(["user_id", "user-1"]);
  });

  it("returns the caller's own org and role", async () => {
    state.membershipRow = { org_id: "org-1", role: "member" };

    const result = await getCurrentMembership();

    expect(result).toEqual({ orgId: "org-1", role: "member" });
  });

  it("returns null when there is no signed-in user", async () => {
    state.userId = null;

    const result = await getCurrentMembership();

    expect(result).toBeNull();
    // Never even queries memberships without a user to scope to.
    expect(state.eqCalls).toEqual([]);
  });

  it("returns null when the user has no membership row", async () => {
    state.membershipRow = null;

    const result = await getCurrentMembership();

    expect(result).toBeNull();
  });
});
