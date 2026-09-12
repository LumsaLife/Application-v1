import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";

/** Routes reachable without a session. Everything else redirects to /login. */
const PUBLIC_PREFIXES = [
  "/login",
  "/auth", // magic-link callback and sign-out
  "/api/auth", // demo entry — see below
  "/api/cron", // authenticates with a bearer secret, not a session
  "/_next",
  "/favicon",
];

/**
 * Refreshes the Supabase session cookie on every request and gates private
 * routes. Called from src/middleware.ts.
 *
 * `/api/auth` has to be public. In demo mode this is where unauthenticated
 * visitors are sent, and gating it would mean redirecting it to itself — an
 * infinite loop. The route carries its own demo-mode check and 404s when the
 * flag is off, so that guard is the real gate rather than this list.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.supabaseUrl(), env.supabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // getUser() revalidates against the auth server. Do not swap this for
  // getSession(), which trusts an unverified cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic =
    pathname === "/" || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();

    // Demo mode sends visitors through anonymous sign-in instead of the
    // magic-link page, so the app opens straight away. /login still exists and
    // becomes the gate again the moment the flag is off.
    url.pathname = env.demoMode() ? "/api/auth/demo" : "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return response;
}
