import { createServerClient, type SetAllCookies } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// /invite/accept has to be public even though it's not a "log in" page:
// it's reached with no session cookie at all (the invite link's session
// tokens arrive as a URL hash fragment or code param, established
// entirely client-side — see that page's own comment for why), so
// requiring an existing session to reach it would redirect every real
// invite link straight to /login before the page can even run.
const PUBLIC_PATHS = ["/login", "/invite/accept"];

// Refreshes the session on every request. Server Components can't write
// cookies, so an expiring auth token would otherwise never get renewed —
// this runs in the proxy layer, which can, and keeps both the request and
// the response cookies in sync.
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: Parameters<SetAllCookies>[0]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicPath = PUBLIC_PATHS.some((path) => request.nextUrl.pathname.startsWith(path));

  if (!user && !isPublicPath) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  return supabaseResponse;
}
