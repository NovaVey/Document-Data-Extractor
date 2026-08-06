import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// The only place in the web app that touches the service-role key. Every
// other client here (client.ts, server.ts) is anon-key + RLS-scoped by
// design — worker/src/supabase.ts's own comment states that principle
// explicitly ("must never be... reused by the Next.js app's user-facing
// code paths"), and that held until the self-service invite flow, which
// genuinely needs two admin-only operations no RLS-scoped client can do:
// creating an auth user for someone who hasn't signed up yet
// (auth.admin.inviteUserByEmail) and reading an org member's email —
// never exposed via PostgREST/RLS, auth.users isn't a queryable table
// for a normal client.
//
// MUST NEVER be imported from a "use client" file, and every Server
// Action/Route Handler that uses it must check the caller is an org
// owner itself first (see src/app/settings/members/actions.ts) — unlike
// every RLS-scoped client elsewhere in this app, nothing stops this
// client from acting as any org.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
