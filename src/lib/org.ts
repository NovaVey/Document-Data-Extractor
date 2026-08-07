import { createClient } from "@/lib/supabase/server";

export type Membership = { orgId: string; role: "owner" | "member" };

// This query has no explicit user_id filter of its own — it relies
// entirely on RLS to scope the result set. That was safe when "org
// members can view memberships in their org" was written: at the time
// every org had exactly one member (its owner), so "the org's only
// membership row" and "my membership row" were the same thing. The
// invite flow broke that assumption without anyone touching this
// function: that same RLS policy is deliberately org-wide (any member
// can see every membership in their org, not just their own — the
// Members page needs that), so once an org has 2+ members, an unfiltered
// `.order(created_at).limit(1)` returns whichever row was created first
// for the ORG, not the caller's own row. Since the owner's row is always
// created first (the signup trigger creates it), every non-owner member
// of a multi-person org was silently treated as an owner here — wrongly
// granted owner-only UI (Members link, template New/Edit/Delete) and
// passing requireOwnerMembership()'s pre-check, only to have the actual
// write rejected by is_writable_org_owner()'s RLS (which does check
// auth.uid() correctly) with a confusing raw DB error instead of the
// friendly "only an owner can..." message. Caught live: a seeded
// "member"-role demo user saw the owner's Members link.
//
// This used to have a getCurrentOrgId() sibling (org_id only, no role) —
// dropped once role enforcement shipped and the last caller migrated to
// this instead; a repo-wide grep confirmed zero remaining references
// before removing it (low-priority audit finding, dead code).
export async function getCurrentMembership(): Promise<Membership | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("memberships")
    .select("org_id, role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { orgId: data.org_id, role: data.role as "owner" | "member" };
}

export const NO_MEMBERSHIP_ERROR = "No organization membership found";

// Medium-priority audit finding: the `if (!membership) ...; if
// (membership.role !== "owner") ...` pair was hand-duplicated across every
// owner-only Server Action — templates/actions.ts's three (create/update/
// delete) and settings/members/actions.ts's three (invite/remove/update
// role), six call sites total, each with its own near-identical error
// string. The *logic* is what actually mattered to converge — if this
// check ever needs a third condition (e.g. a suspended-org check), there
// was no single place to add it. Each caller still supplies its own
// domain-specific message (templates vs. members) rather than one generic
// string everywhere, since "only an owner can manage templates" is
// genuinely more useful than a one-size-fits-all message would be — this
// dedupes the conditional, not the wording.
//
// The real enforcement in every one of these call sites is still the RLS
// policy the underlying write hits (is_writable_org_owner()) — this is
// the same fast-fail-with-a-clear-message layer it always was, just
// centralized.
export async function requireOwnerMembership(
  notAnOwnerMessage: string,
): Promise<{ membership: Membership } | { error: string }> {
  const membership = await getCurrentMembership();
  if (!membership) return { error: NO_MEMBERSHIP_ERROR };
  if (membership.role !== "owner") return { error: notAnOwnerMessage };
  return { membership };
}
