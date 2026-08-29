-- Lumsa — initial schema
--
-- Design notes:
--   * Every table is keyed to auth.users and protected by RLS. A user can only
--     ever read or write their own rows; the cron jobs use the service-role key,
--     which bypasses RLS by design.
--   * We deliberately do NOT mirror the user's calendar. `daily_meditations`
--     stores a small derived JSON signal (counts, densities, coarse buckets)
--     and nothing else. Event titles are read in memory during generation and
--     never persisted.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type tone_preference as enum (
  'secular',      -- generic / non-denominational spiritual (default)
  'christian',
  'buddhist',
  'muslim',
  'jewish',
  'hindu',
  'mindfulness',  -- secular mindfulness, clinical-adjacent language
  'blended'       -- "surprise me" — rotates imagery across traditions
);

create type calendar_provider as enum ('google', 'microsoft');

create type theme_preference as enum ('system', 'light', 'dark');

create type audio_status as enum ('pending', 'ready', 'failed', 'skipped');

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table profiles (
  user_id                  uuid primary key references auth.users(id) on delete cascade,
  display_name             text        not null default '',
  mantra                   text        not null default '',
  life_quest               text        not null default '',
  tone_preference          tone_preference not null default 'secular',
  meditation_length_pref   smallint    not null default 10
                             check (meditation_length_pref in (5, 10, 15)),

  -- IANA timezone, e.g. "America/New_York". Drives the overnight generation
  -- cron: we generate for a user when their *local* clock passes the target hour.
  timezone                 text        not null default 'UTC',

  -- When true, the "why this today" line may name calendar events directly
  -- ("your 2pm performance review"). Default is the gentler, shape-only phrasing.
  reference_events_by_name boolean     not null default false,

  theme_preference         theme_preference not null default 'system',

  reminder_email_enabled   boolean     not null default true,

  onboarded_at             timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on column profiles.timezone is
  'IANA timezone. The generation cron compares this against UTC to find users whose local morning has just begun.';

-- ---------------------------------------------------------------------------
-- calendar_connections
-- ---------------------------------------------------------------------------

create table calendar_connections (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users(id) on delete cascade,
  provider               calendar_provider not null,

  -- AES-256-GCM ciphertext produced by src/lib/crypto.ts. Never stored plain.
  -- Postgres columns are not encrypted at rest by default, so we encrypt in the
  -- application layer with a key that lives only in the environment.
  access_token_encrypted   text,
  refresh_token_encrypted  text not null,
  access_token_expires_at  timestamptz,

  -- Which account this is, shown in Settings so a user can tell two Google
  -- accounts apart. Not used for anything else.
  account_email          text,

  scopes                 text[] not null default '{}',
  connected_at           timestamptz not null default now(),
  last_synced_at         timestamptz,

  -- Set when the provider rejects our refresh token (revoked access, password
  -- change). Surfaced in Settings as "reconnect needed" rather than failing silently.
  invalid_since          timestamptz,

  unique (user_id, provider)
);

create index calendar_connections_user_idx on calendar_connections (user_id);

-- ---------------------------------------------------------------------------
-- daily_meditations
-- ---------------------------------------------------------------------------

create table daily_meditations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,

  -- The user's LOCAL date, not UTC. "Today" is a human concept here.
  local_date      date not null,

  script_text     text not null,
  why_today       text not null,

  audio_url       text,
  audio_status    audio_status not null default 'pending',
  audio_duration_seconds integer,

  -- Small derived JSON: meeting counts, density bucket, longest free block.
  -- Explicitly NOT a calendar mirror — see CalendarSignal in src/lib/calendar/signal.ts.
  calendar_signal jsonb not null default '{}'::jsonb,

  -- Snapshot of the inputs, so we can tell why an old meditation reads the way
  -- it does after the user changes their preferences.
  tone_used       tone_preference not null,
  length_used     smallint not null,

  -- Set the first time the user finishes a session. Drives the streak count.
  completed_at    timestamptz,

  created_at      timestamptz not null default now(),

  unique (user_id, local_date)
);

create index daily_meditations_user_date_idx
  on daily_meditations (user_id, local_date desc);

-- ---------------------------------------------------------------------------
-- journal_entries
-- ---------------------------------------------------------------------------

create table journal_entries (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  meditation_id   uuid references daily_meditations(id) on delete set null,

  reflection_text text,
  -- One of the five mood taps offered after a session. Free of clinical framing
  -- on purpose; these are felt-sense words, not a validated instrument.
  mood            text check (mood in ('heavy', 'tender', 'steady', 'light', 'radiant')),

  created_at      timestamptz not null default now(),

  -- An entry with neither a mood nor text is meaningless; block it at the DB.
  constraint journal_entries_not_empty
    check (reflection_text is not null or mood is not null)
);

create index journal_entries_user_created_idx
  on journal_entries (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Create a profile row automatically on signup
-- ---------------------------------------------------------------------------

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', '')
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table profiles             enable row level security;
alter table calendar_connections enable row level security;
alter table daily_meditations    enable row level security;
alter table journal_entries      enable row level security;

create policy "own profile" on profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Note: the client never needs to READ tokens — only to see that a connection
-- exists and to delete it. Token columns are only ever read server-side with
-- the service-role key. Column-level restriction is enforced in the data layer
-- (src/lib/calendar/connections.ts) by never selecting the token columns.
create policy "own calendar connections" on calendar_connections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own meditations" on daily_meditations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own journal entries" on journal_entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
