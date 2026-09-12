import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";

/**
 * Demo entry — skips sign-in.
 *
 * Creates a Supabase *anonymous* session rather than signing everyone into one
 * shared demo account. That matters: an anonymous user has a real auth.uid(),
 * so every RLS policy, the generation pipeline, the journal and Daily Light all
 * run on their normal code paths, and each visitor's data is invisible to every
 * other visitor. A shared account would put all of them in one pile.
 *
 * Only reachable while NEXT_PUBLIC_DEMO_MODE=true; returns 404 otherwise, so an
 * accidental production deploy cannot be walked into through this URL.
 *
 * Requires "Allow anonymous sign-ins" to be enabled in the Supabase dashboard
 * (Authentication → Sign In / Providers). Without it the API rejects the call
 * and this route says so plainly rather than redirecting into a loop.
 */

/** Seeded so a visitor lands on a working Today screen, not an empty one. */
const DEMO_PROFILE = {
  display_name: "",
  mantra: "Begin again.",
  life_quest: "Be more patient with my team.",
  tone_preference: "secular" as const,
  meditation_length_pref: 10 as const,
};

export async function GET(request: NextRequest) {
  const { origin, searchParams } = request.nextUrl;

  if (!env.demoMode()) {
    return new NextResponse("Not found", { status: 404 });
  }

  const supabase = await createClient();

  // Only redirect within our own app.
  const requested = searchParams.get("next") ?? "/today";
  const next = requested.startsWith("/") ? requested : "/today";
  const restart = searchParams.get("restart") === "1";

  const {
    data: { user: existing },
  } = await supabase.auth.getUser();

  let userId = existing?.id;

  if (!userId) {
    const { data, error } = await supabase.auth.signInAnonymously();

    if (error || !data.user) {
      console.error("[demo] anonymous sign-in failed:", error?.message);
      return new NextResponse(
        "Demo sign-in failed. Enable \"Allow anonymous sign-ins\" in your " +
          "Supabase project under Authentication → Sign In / Providers, then " +
          "reload.\n\n" +
          `Supabase said: ${error?.message ?? "no user returned"}`,
        { status: 500, headers: { "content-type": "text/plain" } },
      );
    }
    userId = data.user.id;
  }

  // The handle_new_user trigger has already created the profile row; fill it in
  // so the visitor lands on a Today screen with something to generate from.
  // `restart` clears onboarded_at instead, to walk the real onboarding flow.
  const { error: profileError } = await supabase
    .from("profiles")
    .update(
      restart
        ? { onboarded_at: null }
        : { ...DEMO_PROFILE, onboarded_at: new Date().toISOString() },
    )
    .eq("user_id", userId);

  if (profileError) {
    console.error("[demo] failed to seed profile:", profileError.message);
  }

  return NextResponse.redirect(`${origin}${restart ? "/onboarding" : next}`);
}
