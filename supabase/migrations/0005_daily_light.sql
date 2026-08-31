-- Daily Light — a small daily act of kindness alongside the meditation.
--
-- Two tables: `challenges` is the admin-managed library, `user_challenges` is
-- one row per user per day.
--
-- Note on the unique (user_id, local_date) constraint: it is what makes the
-- day's offer stable, but "Not today" has to hand back an alternative on the
-- same day, and a second row cannot exist. So the swap updates the row in
-- place and records what was passed over in `skipped_challenge_ids`. Without
-- that column the skipped challenge would be invisible to the 30-day exclusion
-- (it could reappear tomorrow) and there would be no way to tell that the day's
-- single swap had been spent — which is what stops this becoming a slot machine.

-- ---------------------------------------------------------------------------
-- profiles additions
-- ---------------------------------------------------------------------------

alter table profiles
  -- Gates the Phase 2 admin UI and the write policy on `challenges` below.
  add column is_admin boolean not null default false,
  -- Draws challenges from the family-facing set. Surfaced as a Settings toggle;
  -- off by default because the adult set is the safe general case.
  add column family_mode boolean not null default false;

-- ---------------------------------------------------------------------------
-- Admin check
-- ---------------------------------------------------------------------------

-- security definer on purpose. A policy on `challenges` that read `profiles`
-- directly would re-enter RLS on profiles from inside policy evaluation, which
-- Postgres either refuses or resolves surprisingly. Running the lookup as the
-- definer sidesteps that. search_path is pinned so the function cannot be
-- redirected at a shadowed `profiles` table.
create or replace function is_current_user_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select is_admin from public.profiles where user_id = auth.uid()),
    false
  );
$$;

revoke execute on function is_current_user_admin() from public;
grant execute on function is_current_user_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- challenges — the library
-- ---------------------------------------------------------------------------

-- Deliberately text + CHECK rather than Postgres enums. Adding a category
-- through the Supabase table editor should not require an ALTER TYPE, and
-- until the admin UI exists the table editor is the admin UI.
create table challenges (
  id              uuid primary key default gen_random_uuid(),

  -- Stable key for seeding. The seed file is the source of truth and upserts
  -- on this, so re-running the seed never duplicates a row.
  slug            text not null unique,

  title           text not null,
  invitation      text not null,

  category        text not null check (category in (
                    'generosity', 'connection', 'grace', 'presence',
                    'words', 'service', 'gratitude', 'family'
                  )),

  -- 1 = under a minute, 2 = a few minutes, 3 = takes real intent.
  effort          smallint not null check (effort between 1 and 3),

  cost            text not null default 'none' check (cost in ('none', 'small')),
  context         text not null check (context in ('anywhere', 'out', 'work', 'home')),
  audience        text not null check (audience in ('adult', 'family', 'both')),

  requires_others boolean not null default false,

  -- Selection weighting. Higher means more likely to be drawn.
  weight          smallint not null default 1 check (weight > 0),
  active          boolean not null default true,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Every column beyond slug/title/invitation/category/effort/context/audience
-- has a default, so a row can be added by hand with just those seven.

create index challenges_active_idx on challenges (active) where active;

create trigger challenges_set_updated_at
  before update on challenges
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- user_challenges — one row per user per day
-- ---------------------------------------------------------------------------

create table user_challenges (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  challenge_id    uuid not null references challenges(id) on delete restrict,

  -- The user's LOCAL date, matching daily_meditations.local_date. Named the
  -- same way on purpose; `date` alone would shadow the type name and read
  -- inconsistently against the rest of the schema.
  local_date      date not null,

  status          text not null default 'offered'
                    check (status in ('offered', 'completed', 'skipped')),

  completed_at    timestamptz,

  -- Phase 2: an optional one-line reflection after Done.
  reflection_text text,

  -- Challenges passed over today. Feeds the 30-day exclusion so a skipped
  -- challenge does not resurface tomorrow, and its length is how we know the
  -- day's single swap has been spent.
  skipped_challenge_ids uuid[] not null default '{}',

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (user_id, local_date)
);

create index user_challenges_user_date_idx
  on user_challenges (user_id, local_date desc);

-- The 30-day exclusion query filters by user and date range, then reads
-- challenge_id. Covering it keeps that off the heap.
create index user_challenges_history_idx
  on user_challenges (user_id, local_date desc, challenge_id);

create trigger user_challenges_set_updated_at
  before update on user_challenges
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table challenges      enable row level security;
alter table user_challenges enable row level security;

-- The library is shared content: any signed-in user may read the active rows.
create policy "authenticated read challenges" on challenges
  for select to authenticated
  using (true);

-- Writes are admin-only. Split into three policies rather than FOR ALL so the
-- intent of each is legible, and so a future read-only-admin role is a smaller
-- change.
create policy "admins insert challenges" on challenges
  for insert to authenticated
  with check (is_current_user_admin());

create policy "admins update challenges" on challenges
  for update to authenticated
  using (is_current_user_admin())
  with check (is_current_user_admin());

create policy "admins delete challenges" on challenges
  for delete to authenticated
  using (is_current_user_admin());

create policy "own challenge history" on user_challenges
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
