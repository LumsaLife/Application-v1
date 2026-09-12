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
  NEXT_PUBLIC_DEMO_MODE: process.env.NEXT_PUBLIC_DEMO_MODE,
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

/**
 * Parse a boolean-ish environment variable.
 *
 * Deliberately forgiving. These values get typed into a dashboard form by hand,
 * where a trailing space or a capital letter is invisible and a strict
 * `=== "true"` comparison fails silently — you get the old behaviour with no
 * error to explain why. This project has already lost a deploy cycle to an
 * invisible leading space in a Vercel settings field.
 */
function flag(name: string): boolean {
  const raw = read(name);
  if (!raw) return false;
  return ["true", "1", "yes", "on"].includes(raw.trim().toLowerCase());
}

export const env = {
  // --- Supabase -----------------------------------------------------------
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),

  /**
   * Non-throwing reads of the Supabase config.
   *
   * Middleware runs on every request, so a throw there takes down the whole
   * site — public pages included, and the diagnostic route with them. It needs
   * to be able to ask whether config exists without being blown up by the
   * answer.
   */
  supabaseConfigured: () =>
    Boolean(
      optional("NEXT_PUBLIC_SUPABASE_URL") &&
        optional("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    ),
  supabaseUrlOptional: () => optional("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKeyOptional: () => optional("NEXT_PUBLIC_SUPABASE_ANON_KEY"),

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

  /**
   * Demo mode — skips sign-in entirely.
   *
   * Visitors get a Supabase *anonymous* session instead of the magic-link
   * flow: a real auth.uid(), so RLS, generation, journal and Daily Light all
   * run on their normal code paths, and each visitor's data stays isolated
   * from every other visitor's. A shared demo account would not give you that.
   *
   * This is still an auth bypass. Anyone with the URL gets a session and can
   * spend your Claude and ElevenLabs credits, so it is off unless explicitly
   * switched on, and the UI carries a banner whenever it is active. Never set
   * it in production.
   */
  demoMode: () => flag("NEXT_PUBLIC_DEMO_MODE"),

  /** Raw value, for the diagnostic route. */
  demoModeRaw: () => read("NEXT_PUBLIC_DEMO_MODE"),

  // --- App ----------------------------------------------------------------
  appUrl: () =>
    optional("NEXT_PUBLIC_APP_URL") ??
    (optional("VERCEL_URL") ? `https://${optional("VERCEL_URL")}` : "http://localhost:3000"),
} as const;

/**
 * Required variables that are absent from this build.
 *
 * Non-throwing on purpose: it is used to render a "finish setup" screen instead
 * of letting a page throw. An unhandled server exception on Vercel surfaces as
 * "Application error ... Digest: 3318172160", which tells the person looking at
 * it nothing at all.
 */
export function missingRequiredConfig(): string[] {
  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ANTHROPIC_API_KEY",
    "ENCRYPTION_KEY",
    "CRON_SECRET",
  ];

  // Read through the same accessors the app uses, so this cannot disagree with
  // what the rest of the code sees — including the PUBLIC_ENV inlining.
  const resolved: Record<string, string | undefined> = {
    NEXT_PUBLIC_SUPABASE_URL: env.supabaseUrlOptional(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: env.supabaseAnonKeyOptional(),
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
    CRON_SECRET: process.env.CRON_SECRET,
  };

  return required.filter((name) => !resolved[name]);
}

/** True when calendar OAuth is configured for a provider. Drives Settings UI. */
export const calendarConfigured = {
  google: () => Boolean(env.googleClientId() && env.googleClientSecret()),
  microsoft: () => Boolean(env.microsoftClientId() && env.microsoftClientSecret()),
};
