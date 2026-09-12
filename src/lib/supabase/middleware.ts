import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";

/** Routes reachable without a session. Everything else redirects to sign-in. */
const PUBLIC_PREFIXES = [
  "/login",
  "/auth", // magic-link callback and sign-out
  "/api/auth", // demo entry and the config diagnostic — see below
  "/api/cron", // authenticates with a bearer secret, not a session
  "/_next",
  "/favicon",
];

/** Logged once per instance rather than once per request. */
let warnedAboutConfig = false;

/**
 * Refreshes the Supabase session cookie on every request and gates private
 * routes. Called from src/middleware.ts.
 *
 * ── Why this never throws ─────────────────────────────────────────────────────
 * Middleware runs on EVERY request, so anything that throws here returns a 500
 * for the entire site — the landing page, the sign-in page, and the diagnostic
 * route meant to explain the outage. That is exactly what happened: reading the
 * Supabase config through the throwing `required()` accessor turned one missing
 * environment variable into a total outage with a
 * MIDDLEWARE_INVOCATION_FAILED and nothing to debug it with.
 *
 * So this fails open. Every page already guards itself with its own
 * `redirect("/login")` when there is no user, so letting a request through
 * cannot expose anyone's data — it just means the page, rather than the
 * middleware, is the thing that turns them away. A misconfigured deployment
 * now renders a working site that asks for sign-in, instead of a 500.
 *
 * `/api/auth` has to be public: in demo mode it is where unauthenticated
 * visitors are sent, and gating it would mean redirecting it to itself, an
 * infinite loop. Those routes carry their own checks.
 */
export async function updateSession(request: NextRequest) {
  try {
    return await handle(request);
  } catch (error) {
    // Never let middleware take the site down. Pages still gate themselves.
    console.error(
      "[middleware] failed open — request allowed through without session " +
        "handling. Pages will still require sign-in:",
      error,
    );
    return NextResponse.next({ request });
  }
}

async function handle(request: NextRequest) {
  const supabaseUrl = env.supabaseUrlOptional();
  const supabaseAnonKey = env.supabaseAnonKeyOptional();

  if (!supabaseUrl || !supabaseAnonKey) {
    if (!warnedAboutConfig) {
      warnedAboutConfig = true;
      console.error(
        "[middleware] NEXT_PUBLIC_SUPABASE_URL and/or " +
          "NEXT_PUBLIC_SUPABASE_ANON_KEY are missing from this build. " +
          "Sessions cannot be refreshed and nothing can sign in. Set them and " +
          "REDEPLOY — public variables are compiled in at build time. " +
          "See /api/auth/demo-status for what this build actually resolved.",
      );
    }
    // Serve the site rather than 500 it. Pages will redirect to /login.
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
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
