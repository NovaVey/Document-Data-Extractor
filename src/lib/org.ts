import { createClient } from "@/lib/supabase/server";

// v1 has no invite flow, so every user has exactly one membership (the
// org their signup trigger created for them) — first row is the only row.
export async function getCurrentOrgId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("memberships").select("org_id").limit(1).maybeSingle();
  return data?.org_id ?? null;
}
