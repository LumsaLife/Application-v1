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
  PHASE 1  Claude (claude-opus-5)  ──▶  script + "why this today"
           20-40s · hourly cron at each user's local 5am
       │
       ▼   row lands audio_status='pending'
       │
  PHASE 2  ElevenLabs  ──▶  MP3 in private Supabase Storage
           40-80s · queue worker every 10 min
       │
       ▼
   /today  ──▶  play ──▶  reflect ──▶  streak
```

**Generation runs overnight, in two phases.** An hourly cron writes scripts for
users whose local clock has just passed 5am — one schedule, twenty-four
cohorts. Audio is a separate queue.

The split is not incidental. A Claude call takes 20-40s; an ElevenLabs pass over
a 15-minute script is four chunked requests and takes 40-80s. Doing both inside
one 300-second Vercel function meant it served three or four users before dying,
and everyone else fell through to lazy generation — defeating the entire point
of pre-generating. Now `daily_meditations` *is* the queue: rows land `pending`,
a worker claims them into `synthesizing`, and they end `ready`/`failed`/
`skipped`. No new infrastructure; the table we already had is the work list.

Both crons budget by wall clock rather than a fixed item count, since per-user
cost varies by several-fold. Whatever doesn't fit stays queued for the next run.

Two paths drain the audio queue and they cannot collide: the 10-minute cron, and
the user's own request when they open `/today` to a pending row. Both go through
the same atomic claim, so ElevenLabs is never paid twice for one script.

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
supabase/migrations/0003_audio_queue.sql
supabase/migrations/0004_generation_backoff.sql
supabase/migrations/0005_daily_light.sql
```

Then seed the Daily Light library:

```bash
npm run seed:challenges              # upserts on slug; safe to re-run
npm run seed:challenges -- --dry-run # validate the file, write nothing
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
npm run verify      # pure logic: timezones, signal, chunking, backoff, batching
npm run typecheck
npm run lint
```

`supabase/tests/` holds schema and RLS tests that run the migrations against a
stock Postgres with the Supabase surface stubbed. Worth running after any schema
change — RLS is the only thing between one user's meditations and another's, and
a policy that silently does nothing looks exactly like one that works.

### Daily Light

A small daily act of kindness that sits below the meditation on Today — the
outward half of the practice. One per user per day, chosen from a library of 43
seeded challenges.

Selection (`src/lib/challenges/select.ts`) is pure: no database, no clock, no
environment. It takes the pool, the user's history, and today's calendar signal,
and returns one challenge. Two properties matter and both are covered by
`npm run verify`:

- **Deterministic.** Seeded on `user_id + local_date`, so a refresh never
  re-rolls the day's invitation. It is also seeded on the skip count, so
  "Not today" genuinely produces something different.
- **A 30-day exclusion window**, counting skipped challenges as offered —
  passing on something is still having seen it.

Hard rules (audience, and the two-money-asks-per-week cap) are filters and are
allowed to empty the pool: a family-mode user must never be shown an adult
challenge because the pool ran thin. Preferences (effort and context, driven by
the calendar signal) are *tiers*, tried strictest-first, so they can never
leave someone with nothing.

One consequence worth knowing: family mode has 23 eligible challenges against a
30-day window, so it reaches the least-recently-offered fallback by design. If
family mode gets real use, the library needs more `audience: family | both`
entries.

**Adding challenges.** Until the Phase 2 admin UI exists, either edit
`supabase/seed/challenges.seed.json` and re-run the seed, or add a row directly
in the Supabase table editor — every column beyond `slug`, `title`,
`invitation`, `category`, `effort`, `context`, `audience` has a default. The
seed file omits `weight` and `active`, which means values you tune in the table
editor survive a re-seed; add them to a seed entry explicitly and the file wins
from then on.

**Tone guardrails**, which live in the copy and should survive edits: nothing
implies failure for a skipped day, there is no streak or score anywhere near
this feature, and the acknowledgement after Done is one quiet line. An
invitation that congratulates you for accepting it stops being an invitation.

### Iterating on the prompt

```bash
npm run preview                                    # one meditation, default inputs
npm run preview -- --tone buddhist --length 15     # try a register
npm run preview -- --density open                  # open | light | moderate | packed | none
npm run preview -- --names                         # SPECIFIC why-today mode
npm run preview -- --prompt-only                   # inspect the prompt, spend nothing
```

This is the fast loop for `src/lib/meditation/prompt.ts` — no signup, no
calendar, no cron. It prints the rendered input, the "why this today" line, the
script, and then the numbers that tell you whether the length target actually
landed: word count, break tags, estimated duration against target, token usage
(including cache hits), and the ElevenLabs character cost the script would
incur. Every run without `--prompt-only` is a real API call.

`npm run verify` covers the places a subtle bug would be invisible in the UI:
timezone maths across DST boundaries, streak counting, the guarantee that
`forStorage()` strips event titles, break-tag splitting (a 7s pause has to
become 3+3+1 without losing silence), script chunking, CBR duration maths, the
batch runner's deadline behaviour, generation backoff, and Daily Light
selection — determinism, the exclusion boundary at exactly 30 days, audience
isolation, and a simulated year of daily selection against the real library.

---

## Deploying

See **[DEPLOY.md](DEPLOY.md)** for the full checklist. The short version, with
two caveats.

**Cron requires Pro.** Hobby allows one cron execution per day, which cannot
serve users in more than one timezone. Three schedules are registered in
`vercel.json`:

| Route | Schedule | Does |
|---|---|---|
| `/api/cron/generate` | hourly | scripts for users hitting 5am local |
| `/api/cron/audio` | every 10 min | drains the synthesis queue |
| `/api/cron/remind` | hourly | emails users hitting 7am local |

All three authenticate with `Authorization: Bearer $CRON_SECRET`, which Vercel
sends automatically once that variable is set on the project. If you ever need
to run them elsewhere, any scheduler that can set a header will do.

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
      cron/generate                  hourly; scripts for users hitting 5am local
      cron/audio                     every 10 min; drains the synthesis queue
      cron/remind                    hourly; emails users hitting 7am local
      meditation/audio               foreground synthesis + status polling
  lib/
    batch.ts                  time-budgeted concurrent runner for the crons
    challenges/
      select.ts               ← Daily Light selection. Pure and testable.
      random.ts               seeded RNG + weighted pick
      service.ts              persistence, swap handling
      types.ts
    meditation/
      prompt.ts               ← the prompt template. Start here to change tone.
      generate.ts             the Claude call. Plumbing only.
      tts.ts                  ElevenLabs / OpenAI, retries, storage
      script-chunking.ts      pure text transforms (breaks, chunks, duration)
      service.ts              two-phase orchestration + the audio queue
    calendar/
      signal.ts               ← calendar → shape. The privacy boundary.
      google.ts, microsoft.ts  provider specifics
      index.ts                token refresh, unified fetch
    time.ts                   local-date arithmetic and streaks
    crypto.ts                 AES-256-GCM for refresh tokens
supabase/migrations/          schema + RLS + storage bucket
supabase/seed/                Daily Light challenge library (checked in)
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
  This is the dominant cost and scales linearly with users *and* session length:
  a user on 15 minutes costs roughly three times one on 5. Worth modelling
  before you open signups.

Synthesis retries are bounded at `MAX_AUDIO_ATTEMPTS` (3) per meditation, after
which the row is marked `failed` and left alone — otherwise one permanently
broken script is retried by every ten-minute run forever. Character counts are
logged per synthesis (`[tts] synthesized …`) so you can total real spend from
the logs rather than guessing.

Verify caching is working by checking `cache_read_input_tokens` in the response
usage — `generate.ts` returns it, and `npm run preview` prints it. If it is zero
across a batch, either something started varying the system prompt, or you
changed to a model with a higher minimum cacheable prefix (it is 512 tokens on
Claude Opus 5, but 4,096 on some others, and falling under it fails silently).

Generation failures back off per profile — 30m, 1h, 2h, 4h, capped at 6h —
because `/today` is `force-dynamic` and would otherwise fire a Claude call on
every page refresh for a profile that reliably fails. Saving settings or hitting
"Regenerate today" clears the backoff, since editing your inputs is the signal
you have fixed whatever it choked on.

---

## Not built yet

- **Daily Light Phase 2**: the `/admin/challenges` route gated on
  `profiles.is_admin` (the column and its RLS policies exist, the UI does not),
  the optional one-line reflection after Done (`reflection_text` is on the
  table, unused), a cumulative "lights lit" count, and the weekly email variant.
- Ambient background audio bed under the narration (nice-to-have, not MVP)
- Web push (email only for now)
- Feeding journal entries into generation quality beyond the last three
  reflections, which are already passed as light tone context
- Any hardware integration
