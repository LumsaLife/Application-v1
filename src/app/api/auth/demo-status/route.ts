import { NextResponse } from "next/server";
import { env } from "@/lib/env";

/**
 * Diagnostic for demo mode.
 *
 * Always responds, including when demo mode is off — which is exactly when you
 * need it. Reports what the running build actually resolved, so "is the flag
 * on?" stops being guesswork about whether a dashboard edit took effect and
 * whether the redeploy picked it up.
 *
 * Leaks nothing: NEXT_PUBLIC_DEMO_MODE is a public variable already compiled
 * into the browser bundle, and nothing else is reported.
 *
 * Lives under /api/auth so the existing public-prefix rule in middleware covers
 * it. A diagnostic that gets redirected to the sign-in page it is meant to
 * explain would be useless.
 */
export async function GET() {
  const raw = env.demoModeRaw();
  const enabled = env.demoMode();

  return NextResponse.json(
    {
      demoModeEnabled: enabled,
      rawValue: raw ?? null,
      // Whitespace in a dashboard field is invisible; show it explicitly.
      rawValueQuoted: raw === undefined ? null : JSON.stringify(raw),
      accepts: ["true", "1", "yes", "on"],
      diagnosis: enabled
        ? "Demo mode is ON. Visiting / and pressing Begin should open the app without sign-in."
        : raw === undefined
          ? "NEXT_PUBLIC_DEMO_MODE is not present in this build. Set it in Vercel, then REDEPLOY — public variables are compiled in at build time, so setting one does not affect an existing deployment."
          : `NEXT_PUBLIC_DEMO_MODE is present but did not read as true. Its exact value is ${JSON.stringify(raw)} — check for stray whitespace or quotes.`,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
