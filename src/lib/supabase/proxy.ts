import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/types/database";

/** Paths reachable without a session (spec §9 Phase 1 step 5). */
const PUBLIC_PREFIXES = ["/login", "/set-password", "/auth/", "/e/", "/api/webhooks/", "/api/cron/", "/api/public/"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p.replace(/\/$/, "") || pathname.startsWith(p));
}

/**
 * Refreshes the Supabase session cookie and redirects unauthenticated requests to /login.
 * Do not add logic between client creation and getClaims(); see @supabase/ssr docs.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const env = publicEnv();

  const supabase = createServerClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const { pathname, search } = request.nextUrl;

  if (!signedIn && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return redirectWithCookies(url, response);
  }

  if (signedIn && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return redirectWithCookies(url, response);
  }

  return response;
}

// A redirect must carry any refreshed session cookies, or the user is logged out.
function redirectWithCookies(url: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}
