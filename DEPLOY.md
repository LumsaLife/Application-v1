# Deploying Lumsa

Vercel Pro is required — see the bottom for why it isn't optional.

Work top to bottom. Steps 1–3 have to happen before the first deploy;
everything after can follow.

---

## 1. Supabase

Create a project, then in the SQL editor run each migration **in order**:

```
supabase/migrations/0001_initial_schema.sql
supabase/migrations/0002_storage.sql
supabase/migrations/0003_audio_queue.sql
supabase/migrations/0004_generation_backoff.sql
supabase/migrations/0005_daily_light.sql
```

All five have been run against a real Postgres 16 and apply cleanly, including
the RLS policies (see `supabase/tests/`).

Then, from **Project Settings**, collect:

- Data API → Project URL
- API Keys → `anon` key and `service_role` key

In **Authentication → URL Configuration**, set **Site URL** to your production
domain and add it to **Redirect URLs**. Sign-in builds its magic-link redirect
from the browser's origin, so links bounce without this. Add
`http://localhost:3000` too if you want local sign-in to work.

The built-in email sender is rate-limited and fine for testing only — configure
SMTP before you invite anyone real.

## 2. Generate two secrets

```bash
openssl rand -base64 32   # ENCRYPTION_KEY
openssl rand -hex 32      # CRON_SECRET
```

**Back up `ENCRYPTION_KEY`.** It decrypts stored calendar refresh tokens.
Rotating or losing it disconnects every user's calendar permanently.

## 3. Environment variables in Vercel

Set these for **Production, Preview and Development**.

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Must exist **at build time** — it is compiled into the browser bundle |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Same |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Bypasses RLS. Server only — never prefix with `NEXT_PUBLIC_` |
| `ANTHROPIC_API_KEY` | yes | Writes the meditation scripts |
| `ENCRYPTION_KEY` | yes | From step 2 |
| `CRON_SECRET` | yes | From step 2. Vercel sends it to cron routes automatically once set |
| `NEXT_PUBLIC_APP_URL` | effectively | Your real domain, e.g. `https://lumsa.app` |
| `ELEVENLABS_API_KEY` | effectively | Without it, playback falls back to a screen-reader voice |
| `GOOGLE_CLIENT_ID` / `_SECRET` | optional | Google Calendar |
| `MICROSOFT_CLIENT_ID` / `_SECRET` | optional | Outlook / Teams |
| `RESEND_API_KEY`, `EMAIL_FROM` | optional | Daily reminder email |

`scripts/setup-vercel-env.sh` pushes everything from a local `.env.local` in one
pass, rather than pasting twelve values into a form.

> **Why `NEXT_PUBLIC_APP_URL` matters.** Without it the app falls back to
> `VERCEL_URL`, which is a per-deployment hostname that changes on every push.
> OAuth redirect URIs would never match what you registered, and every calendar
> connection would fail.

## 4. Deploy

```bash
npm i -g vercel
vercel link
./scripts/setup-vercel-env.sh     # pushes .env.local to Vercel
vercel                            # preview deployment
vercel --prod                     # production
```

Vercel builds production from your repo's **default branch**. This work is on
`claude/new-session-ynkm88` — merge it first, or point the project at that
branch in Settings → Git.

## 5. Seed the Daily Light library

Once the database exists, from your machine:

```bash
npm run seed:challenges -- --dry-run   # validates, writes nothing
npm run seed:challenges                # upserts 43 challenges on slug
```

Needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.
Safe to re-run; it never duplicates.

## 6. Calendars (optional, but it's the whole premise)

Both need your **production** domain, which means doing them after step 4 if
you don't have a custom domain yet.

**Google** — [Cloud Console](https://console.cloud.google.com) → enable the
Google Calendar API → OAuth 2.0 Client ID (Web application). Authorised redirect
URI:

```
https://YOUR-DOMAIN/api/calendar/google/callback
```

**Microsoft** — [Azure Portal](https://portal.azure.com) → Entra ID → App
registrations → New registration. Delegated permissions: `Calendars.Read`,
`User.Read`, `offline_access`. Redirect URI (type *Web*):

```
https://YOUR-DOMAIN/api/calendar/microsoft/callback
```

These must match `NEXT_PUBLIC_APP_URL` character for character.

## 7. Email (optional)

Resend → verify your sending domain, then set `RESEND_API_KEY` and `EMAIL_FROM`.
The default `hello@lumsa.app` will not send unless you own and verify it.

---

## Verifying the deploy

A green build does **not** mean a working deploy — public env vars are compiled
into the browser bundle, so a missing one ships a broken page from a successful
build. Check in this order:

1. Load `/` — should render in both light and dark.
2. Load `/login` and submit an email. If the magic link doesn't arrive, it's
   step 1's Redirect URLs.
3. Open the link, complete onboarding.
4. `/today` should generate a script within ~30s, then show "Preparing your
   narration…" and swap in the audio player when synthesis finishes.
5. Confirm Daily Light appears below the meditation.

Cron routes can be triggered by hand:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR-DOMAIN/api/cron/generate
curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR-DOMAIN/api/cron/audio
```

Each returns JSON with counts. They are safe to run repeatedly — generation is
idempotent per (user, local date), and audio synthesis is claimed atomically.

## Opening the preview without sign-in

To let people (or yourself) straight into the app while previewing, set:

```
NEXT_PUBLIC_DEMO_MODE=true
```

and enable **Allow anonymous sign-ins** in Supabase under
**Authentication → Sign In / Providers**.

Visitors then get a Supabase *anonymous* session instead of the magic-link
page: `/` → Begin → straight onto Today with a seeded mantra and intention. The
banner at the top of every page links to **Restart onboarding** if you want to
walk the real five-step flow.

Anonymous sessions rather than one shared demo account is the important part.
Each visitor gets a real `auth.uid()`, so every RLS policy, the generation
pipeline, the journal and Daily Light run exactly as they do in production, and
no visitor can see another's meditations. A shared login would put everyone in
one pile and prove nothing about whether the real paths work.

**It is still an auth bypass.** Anyone with the URL is inside and can spend your
Claude and ElevenLabs credits. Set it on a preview deployment only. With the
flag off or absent, `/login` is the gate again and `/api/auth/demo` returns 404
— nothing to remove when you're done.

### Demo mode isn't taking effect

Hit `/api/auth/demo-status` on the deployment. It always responds, including
when demo mode is off, and reports what the running build actually resolved:

```json
{ "demoModeEnabled": false, "rawValue": null, "diagnosis": "..." }
```

`rawValueQuoted` shows the value with quotes around it, so stray whitespace is
visible. The flag accepts `true`, `1`, `yes` or `on`, in any case, with
surrounding whitespace trimmed.

The usual cause is that `NEXT_PUBLIC_DEMO_MODE` was set but the deployment was
not rebuilt. Public variables are compiled into the bundle at build time —
setting one changes nothing about an existing deployment. Redeploy after
setting it, and make sure it is set for the environment you are actually
visiting (Preview and Production are separate).

## Troubleshooting

### `500: MIDDLEWARE_INVOCATION_FAILED` on every page

Middleware crashed. Since it runs on every request, a crash there returns 500
for the whole site — landing page included.

The cause is almost always a missing `NEXT_PUBLIC_SUPABASE_URL` or
`NEXT_PUBLIC_SUPABASE_ANON_KEY` in that environment's build. Middleware now
fails open rather than throwing, so a misconfigured deployment serves a working
site that asks for sign-in instead of a blanket 500 — but the variables still
need setting for anything to work.

Check `/api/auth/demo-status`, which reports which required variables the build
actually resolved (presence only, never values). Then set whatever is missing
and **redeploy** — the `NEXT_PUBLIC_` ones are compiled into the build, so
setting them does nothing to an existing deployment.

If a protected page such as `/today` still 500s while `/` and `/login` render,
that is the same cause: the page needs Supabase and cannot reach it. The
diagnostic will say which variable is absent.

### `No Output Directory named "public" found after the Build completed`

Vercel is treating the project as a **static site** instead of a Next.js app.
The build succeeds, then Vercel looks for a static output directory — which a
Next.js app does not produce — and fails.

It means the project's **Framework Preset is "Other"**, not "Next.js". Vercel
normally auto-detects Next.js from `package.json`; detection gets skipped when a
project is created with the preset chosen manually, or when the Root Directory
points somewhere without a `package.json`.

`vercel.json` pins `"framework": "nextjs"`, which should settle it. If the error
survives a redeploy, fix it on the project itself:

- **Settings → General → Framework Preset** → `Next.js`
- **Settings → General → Root Directory** → empty, or `./`
- Leave **Output Directory** on its default. Do not set it to `.next` — Next.js
  output is handled by Vercel's framework builder, and overriding it breaks
  routing and serverless functions.

Then redeploy. A cached build will not pick up a settings change on its own.

### Build succeeds but the site is broken in the browser

Almost always a missing `NEXT_PUBLIC_*` variable. Those are compiled into the
browser bundle at build time, so a missing one produces a green build and a page
that throws on load. Set them, then **redeploy** — changing an environment
variable does not rebuild by itself.

## Why Pro, specifically

Two independent reasons, either of which alone would force it:

- **Cron frequency.** Hobby allows cron once per day. The audio worker runs
  `*/10 * * * *` and the generator hourly — one schedule serving twenty-four
  timezone cohorts. Neither can run on Hobby.
- **Function duration.** The cron and synthesis routes declare
  `maxDuration = 300`. Hobby caps functions at 60s; an ElevenLabs pass over a
  15-minute script alone takes longer than that.

## Costs, once live

- **Claude** — fractions of a cent per user per day. The system prompt is a
  frozen constant so it caches; check `cache_read_input_tokens` is non-zero.
- **ElevenLabs** — the real number. A 15-minute script is ~9,000 characters, so
  ~9,000 credits per user per day, and it scales with session length: a user on
  15 minutes costs roughly three times one on 5. Model this before opening
  signups. Character counts are logged per synthesis (`[tts] synthesized …`).
