import { createClient } from "@/lib/supabase/server";

// v1 has no invite flow, so every user has exactly one membership (the
// org their signup trigger created for them) — first row is the only row
// today. .order() is added anyway (rather than relying on an implicit
// "only row" guarantee): Postgres makes no ordering promise for a query
// without one, so two differently-shaped queries against the same table
// (this one selects org_id; getCurrentMembership() below selects
// org_id, role) aren't guaranteed to agree on which row is "first" the
// moment a second membership ever exists (e.g. the still-deferred invite
// flow) — ordering now costs nothing (there's only one row to order) and
// removes that as a future divergence risk entirely.
export async function getCurrentOrgId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("memberships")
    .select("org_id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.org_id ?? null;
}

export type Membership = { orgId: string; role: "owner" | "member" };

// Same reasoning as getCurrentOrgId above — added alongside it (not
// merged into it) so every existing call site that only needs orgId
// keeps its original one-column query, and role enforcement (Medium PR F
// backlog item, supabase/migrations/20260805010000_role_enforcement.sql)
// has one obvious place to fetch the caller's role from.
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
