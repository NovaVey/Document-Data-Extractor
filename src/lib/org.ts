import { createClient } from "@/lib/supabase/server";

export type Membership = { orgId: string; role: "owner" | "member" };

// v1 has no invite flow, so every user has exactly one membership (the
// org their signup trigger created for them) — first row is the only row
// today. .order() is added anyway (rather than relying on an implicit
// "only row" guarantee): Postgres makes no ordering promise for a query
// without one, and once a second membership can exist (the invite flow),
// nothing else guarantees which row comes back "first" — ordering now
// costs nothing (there's only one row to order) and removes that as a
// future divergence risk entirely.
//
// This used to have a getCurrentOrgId() sibling (org_id only, no role) —
// dropped once role enforcement shipped and the last caller migrated to
// this instead; a repo-wide grep confirmed zero remaining references
// before removing it (low-priority audit finding, dead code).
export async function getCurrentMembership(): Promise<Membership | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("memberships")
    .select("org_id, role")
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
