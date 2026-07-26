import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server-side client scoped to the current request's session cookie, so
// every query runs as the logged-in user and Postgres RLS policies see
// their auth.uid(). Must be created fresh per request — it captures the
// request's cookies, so a cached instance would leak one user's session
// into another's request.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Parameters<SetAllCookies>[0]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // setAll called from a Server Component — proxy.ts handles
            // session refresh in that case, so this is safe to ignore.
          }
        },
      },
    },
  );
}
