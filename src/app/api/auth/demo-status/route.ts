import { NextResponse } from "next/server";
import { env } from "@/lib/env";

/**
 * Deployment diagnostic.
 *
 * Always responds, whatever the configuration — which is the entire point. When
 * something is missing this is the one endpoint that can still tell you what,
 * so it must never depend on the thing it is reporting on. It reads everything
 * through non-throwing accessors and reports presence as booleans only, never
 * values.
 *
 * Lives under /api/auth so the existing public-prefix rule in middleware covers
 * it. A diagnostic that gets redirected to the sign-in page it is meant to
 * explain would be useless.
 */
export async function GET() {
  const raw = env.demoModeRaw();
  const demoEnabled = env.demoMode();

  // Presence only. Never the values.
  const present = (name: string) => Boolean(process.env[name]);

  const config = {
    NEXT_PUBLIC_SUPABASE_URL: Boolean(env.supabaseUrlOptional()),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(env.supabaseAnonKeyOptional()),
    SUPABASE_SERVICE_ROLE_KEY: present("SUPABASE_SERVICE_ROLE_KEY"),
    ANTHROPIC_API_KEY: present("ANTHROPIC_API_KEY"),
    ENCRYPTION_KEY: present("ENCRYPTION_KEY"),
    CRON_SECRET: present("CRON_SECRET"),
    ELEVENLABS_API_KEY: present("ELEVENLABS_API_KEY"),
  };

  const missingRequired = (
    [
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "ANTHROPIC_API_KEY",
      "ENCRYPTION_KEY",
      "CRON_SECRET",
    ] as const
  ).filter((name) => !config[name]);

  const notes: string[] = [];

  if (missingRequired.length > 0) {
    notes.push(
      `Missing required variables: ${missingRequired.join(", ")}. ` +
        "Set them in Vercel and REDEPLOY — the NEXT_PUBLIC_ ones are compiled " +
        "into the build, so setting them changes nothing about an existing " +
        "deployment. Check you set them for the environment you are visiting; " +
        "Preview and Production are separate.",
    );
  }

  if (!config.ELEVENLABS_API_KEY) {
    notes.push(
      "No TTS provider configured — playback will fall back to the browser's " +
        "built-in voice.",
    );
  }

  notes.push(
    demoEnabled
      ? "Demo mode is ON. Visiting / and pressing Begin should open the app " +
        "without sign-in. This also needs \"Allow anonymous sign-ins\" enabled " +
        "in Supabase under Authentication → Sign In / Providers."
      : raw === undefined
        ? "Demo mode is OFF: NEXT_PUBLIC_DEMO_MODE is not present in this build."
        : `Demo mode is OFF: NEXT_PUBLIC_DEMO_MODE is present but did not read ` +
          `as true. Its exact value is ${JSON.stringify(raw)} — check for stray whitespace.`,
  );

  return NextResponse.json(
    {
      ok: missingRequired.length === 0,
      demoMode: {
        enabled: demoEnabled,
        rawValue: raw ?? null,
        rawValueQuoted: raw === undefined ? null : JSON.stringify(raw),
        accepts: ["true", "1", "yes", "on"],
      },
      // Presence only — no values are ever returned here.
      configPresent: config,
      missingRequired,
      notes,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
