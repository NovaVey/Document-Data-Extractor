import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
}

// The worker is a trusted backend process, not acting "as" any particular
// user — it has to see every org's queue, which is exactly what RLS is
// designed to prevent for a normal client. The service role key bypasses
// RLS entirely; this client must never be sent to a browser or reused by
// the Next.js app's user-facing code paths.
export const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false },
});
