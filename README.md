# Lumsa

*Illuminating your journey.*

A meditation app that writes today's practice from your mantra, what you're
working toward, and the actual shape of your day — rather than handing you the
same session as everyone else.

This repository is the MVP web app. Hardware (the e-ink / desk-clock companion)
is explicitly out of scope; nothing here is scaffolded for it, though the data
model would serve a read-only device without changes.

---

## How it works

```
       ┌─ mantra, life quest, tone, length  (onboarding)
       │
       ├─ calendar signal                   (Google / Microsoft, read-only)
       │    counts, density, free blocks — never a calendar mirror
       │
       ▼
   Claude (claude-opus-5)  ──▶  script + "why this today" line
       │
       ▼
   ElevenLabs  ──▶  MP3 in private Supabase Storage
       │
       ▼
   /today  ──▶  play ──▶  reflect ──▶  streak
```

Generation runs **overnight**: an hourly cron picks up each user as their local
clock passes 5am, so the practice is written and narrated before they wake. The
`/today` route falls back to generating on demand if the cron missed someone.

---

## Setup

### 1. Install

```bash
npm install
cp .env.example .env.local
```

### 2. Supabase

Create a project at [supabase.com](https://supabase.com), then run both
migrations in the SQL editor, in order:

```
supabase/migrations/0001_initial_schema.sql
supabase/migrations/0002_storage.sql
```

Or with the CLI: `supabase db push`.

Copy the project URL, anon key, and service-role key into `.env.local`.

Under **Authentication → Email**, make sure email sign-in is enabled. Magic
links work out of the box with Supabase's built-in mailer for development; use
a custom SMTP provider before launch, as the built-in one is rate-limited.

### 3. Generate the two secrets

```bash
openssl rand -base64 32   # → ENCRYPTION_KEY
openssl rand -hex 32      # → CRON_SECRET
```

`ENCRYPTION_KEY` encrypts calendar refresh tokens (AES-256-GCM) before they are
written to Postgres. **Rotating it invalidates every stored calendar
connection** — users have to reconnect. Back it up somewhere real.

### 4. Claude

Get a key at [console.anthropic.com](https://console.anthropic.com) →
`ANTHROPIC_API_KEY`. This is the only key the app genuinely cannot run without.

### 5. Text to speech (recommended)

Set `ELEVENLABS_API_KEY`. Without any TTS provider the app still works —
playback falls back to the browser's Web Speech API — but it sounds like a
screen reader rather than a meditation. Fine for local development; not fine for
a demo.

ElevenLabs is the default because it honours the `<break time="3s" />` tags the
prompt emits. Silence is not decoration in a meditation, and a provider that
ignores those tags produces a script read aloud rather than a practice. OpenAI
TTS is supported via `TTS_PROVIDER=openai` and is roughly 15× cheaper, but it
has no silence primitive — break tags are stripped and the pacing flattens.

### 6. Calendars (optional)

Both are optional; the app degrades to calendar-free meditations without them.

**Google** — [Cloud Console](https://console.cloud.google.com) → enable the
Google Calendar API → create an OAuth 2.0 Web client. Authorised redirect URI:

```
http://localhost:3000/api/calendar/google/callback
```

**Microsoft** — [Azure Portal](https://portal.azure.com) → Entra ID → App
registrations → new registration. Add the delegated permissions
`Calendars.Read`, `User.Read`, `offline_access`. Redirect URI (type *Web*):

```
http://localhost:3000/api/calendar/microsoft/callback
```

### 7. Run

```bash
npm run dev
```

### Checks

```bash
npm run verify      # local-date arithmetic + calendar signal derivation
npm run typecheck
npm run lint
```

`npm run verify` covers the two places a subtle bug would be invisible in the
UI: timezone maths (including DST boundaries), streak counting, and the
guarantee that `forStorage()` strips event titles.

---

## Deploying

Vercel, with two caveats.

**Cron requires Pro.** The Hobby plan allows one cron execution per day, which
cannot serve users in more than one timezone. On Hobby you have two options:
point an external scheduler (GitHub Actions, cron-job.org) at
`/api/cron/generate` hourly with an `Authorization: Bearer $CRON_SECRET` header,
or drop the cron entirely and let `/today` generate on first visit — that path
already exists and works, it just costs the user a 10–20 second wait.

**Set `NEXT_PUBLIC_APP_URL` to your real domain.** OAuth redirect URIs must
match exactly, and the `VERCEL_URL` fallback produces a deployment-specific
hostname that won't match what you registered with Google and Microsoft.

---

## Where things are

```
src/
  app/
    page.tsx                  landing
    login/                    magic-link sign in
    onboarding/               five questions, then calendar
    today/                    the daily surface — player, script, reflection
    journal/                  past reflections
    settings/                 preferences, connections, theme, reminders
    api/
      calendar/{google,microsoft}/   OAuth connect + callback
      cron/generate                  hourly; generates for users hitting 5am local
      cron/remind                    hourly; emails users hitting 7am local
  lib/
    meditation/
      prompt.ts               ← the prompt template. Start here to change tone.
      generate.ts             the Claude call. Plumbing only.
      tts.ts                  ElevenLabs / OpenAI, chunking, storage
      service.ts              orchestration, idempotent per (user, local date)
    calendar/
      signal.ts               ← calendar → shape. The privacy boundary.
      google.ts, microsoft.ts  provider specifics
      index.ts                token refresh, unified fetch
    time.ts                   local-date arithmetic and streaks
    crypto.ts                 AES-256-GCM for refresh tokens
supabase/migrations/          schema + RLS + storage bucket
```

### Two files worth reading before you change anything

**`src/lib/meditation/prompt.ts`** is where the product's voice lives. The whole
template is one frozen constant — including every tradition's guidance, even
though any given user needs one of them. That looks wasteful and is deliberate:
it keeps the system prompt byte-identical across all users, so it caches, and
the overnight burst pays full input price once instead of once per user. The
rule that follows: **never interpolate per-user content into the system
prompt.** One byte of drift and the cache misses for everybody. Per-user
content goes in `buildUserMessage()`.

**`src/lib/calendar/signal.ts`** is the privacy boundary. It reduces a day to
counts and coarse buckets. Event titles are held in memory only, passed to the
model only when the user has opted in, and stripped by `forStorage()` before
anything is written. If you add a field to `CalendarSignal`, ask whether it
survives that function.

---

## Product decisions worth knowing

**Calendar auth is separate from sign-in.** Supabase's Google provider issues a
sign-in token — no `calendar.readonly` scope, no durable refresh token, so it
cannot read a calendar at 5am while the user sleeps. Lumsa runs its own OAuth
flow for calendars. A user can sign in with a magic link and connect a Google
calendar belonging to an entirely different account.

**"Today" is always the user's local today.** Never UTC. Someone in Auckland and
someone in Los Angeles get different meditations at the same instant, and the
generation cron depends on knowing whose morning it currently is.

**The "why this today" line is indirect by default.** It describes the shape of
the day — "three things close together this afternoon" — without naming events.
Users can opt into event names in Settings. This is a per-person call, and the
default is the one that stays attentive without feeling surveillant.

**Tradition selection is a language filter, not a doctrinal engine.** The system
prompt forbids theological claims in every register. "You might rest in the
sense of being held" is in bounds; "God is holding you" is not. The UI says this
plainly in `TRADITION_DISCLAIMER` — keep that visible if you rework onboarding.

---

## Costs

Per user per day, roughly:

- **Claude** — ~2.5k input tokens (mostly cached after the first request of a
  batch) + ~2k output. Fractions of a cent.
- **ElevenLabs** — a 15-minute script is ~9,000 characters, so ~9,000 credits.
  This is the dominant cost and it scales linearly with users and with session
  length. Worth modelling before you open signups.

Verify caching is working by checking `cache_read_input_tokens` in the response
usage — `generate.ts` returns it. If it is zero across a batch, something has
started varying the system prompt.

---

## Not built yet

- Ambient background audio bed under the narration (nice-to-have, not MVP)
- Web push (email only for now)
- Feeding journal entries into generation quality beyond the last three
  reflections, which are already passed as light tone context
- Any hardware integration
