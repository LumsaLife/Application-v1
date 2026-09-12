/**
 * Must live at src/middleware.ts, not the project root.
 *
 * With a src/ directory Next.js only looks here — a root-level middleware.ts
 * sitting beside src/ is silently ignored, with no warning and no error. That
 * had happened: per-page redirect("/login") calls were still gating routes, so
 * auth looked fine, while the Supabase session refresh below never ran and
 * sessions would quietly expire after about an hour.
 */
import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. Cron routes are matched
     * but allowed through by PUBLIC_PREFIXES — they authenticate with a bearer
     * secret instead of a session.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp3)$).*)",
  ],
};
