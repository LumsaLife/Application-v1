/**
 * Environment access, in one place.
 *
 * Two tiers on purpose:
 *   - `required(...)` throws at call time for things the app genuinely cannot
 *     run without (Supabase, Claude).
 *   - `optional(...)` returns undefined so a feature can degrade gracefully.
 *     Lumsa is meant to be runnable by a new contributor who has a Supabase
 *     project and a Claude key but no ElevenLabs account yet.
 *
 * We read process.env lazily rather than at module load so that importing a
 * module in a test or a build step doesn't explode on a missing key.
 */

/**
 * Public variables, referenced literally.
 *
 * This map is not decoration and must not be collapsed into a loop. Next.js
 * inlines `process.env.NEXT_PUBLIC_*` into the browser bundle by static
 * find-and-replace on the *literal* text — a dynamic `process.env[name]` lookup
 * is left untouched, and `process.env` is an empty object in the browser. Read
 * dynamically, every public variable is `undefined` on the client while the
 * server sees it fine and the build stays green, so the failure only appears
 * once a real user loads the page.
 *
 * Any new NEXT_PUBLIC_ variable has to be spelled out here too.
 */
const PUBLIC_ENV: Record<string, string | undefined> = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
};

function read(name: string): string | undefined {
  // Server-side values win when present; the map covers the client, where
  // process.env is empty.
  return process.env[name] ?? PUBLIC_ENV[name];
}

function required(name: string): string {
  const value = read(name);
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. See .env.example.`,
    );
  }
  return value;
}

function optional(name: string): string | undefined {
  return read(name) || undefined;
}

export const env = {
  // --- Supabase -----------------------------------------------------------
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),

  // --- Claude -------------------------------------------------------------
  anthropicApiKey: () => required("ANTHROPIC_API_KEY"),

  // --- Token encryption ---------------------------------------------------
  encryptionKey: () => required("ENCRYPTION_KEY"),

  // --- TTS ----------------------------------------------------------------
  /** "elevenlabs" | "openai" | "none". Defaults to elevenlabs when a key exists. */
  ttsProvider: (): "elevenlabs" | "openai" | "none" => {
    const explicit = optional("TTS_PROVIDER");
    if (explicit === "elevenlabs" || explicit === "openai" || explicit === "none") {
      return explicit;
    }
    if (optional("ELEVENLABS_API_KEY")) return "elevenlabs";
    if (optional("OPENAI_API_KEY")) return "openai";
    return "none";
  },
  elevenLabsApiKey: () => optional("ELEVENLABS_API_KEY"),
  elevenLabsVoiceId: () =>
    optional("ELEVENLABS_VOICE_ID") ?? "EXAVITQu4vr4xnSDxMaL", // "Sarah" — calm, unhurried
  openaiApiKey: () => optional("OPENAI_API_KEY"),

  // --- Calendar OAuth -----------------------------------------------------
  googleClientId: () => optional("GOOGLE_CLIENT_ID"),
  googleClientSecret: () => optional("GOOGLE_CLIENT_SECRET"),
  microsoftClientId: () => optional("MICROSOFT_CLIENT_ID"),
  microsoftClientSecret: () => optional("MICROSOFT_CLIENT_SECRET"),
  /** Multi-tenant by default so personal and work Microsoft accounts both work. */
  microsoftTenantId: () => optional("MICROSOFT_TENANT_ID") ?? "common",

  // --- Email --------------------------------------------------------------
  resendApiKey: () => optional("RESEND_API_KEY"),
  emailFrom: () => optional("EMAIL_FROM") ?? "Lumsa <hello@lumsa.app>",

  // --- Cron ---------------------------------------------------------------
  cronSecret: () => required("CRON_SECRET"),

  // --- App ----------------------------------------------------------------
  appUrl: () =>
    optional("NEXT_PUBLIC_APP_URL") ??
    (optional("VERCEL_URL") ? `https://${optional("VERCEL_URL")}` : "http://localhost:3000"),
} as const;

/** True when calendar OAuth is configured for a provider. Drives Settings UI. */
export const calendarConfigured = {
  google: () => Boolean(env.googleClientId() && env.googleClientSecret()),
  microsoft: () => Boolean(env.microsoftClientId() && env.microsoftClientSecret()),
};
