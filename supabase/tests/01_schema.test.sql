\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

create or replace function t(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '%  %', case when ok then '  ok  ' else ' FAIL ' end, label; end $$;

-- Expect a statement to violate a constraint.
create or replace function rejects(label text, stmt text) returns void language plpgsql as $$
begin
  execute stmt;
  raise notice ' FAIL  % (was accepted, should have been rejected)', label;
exception when others then
  raise notice '  ok    % (rejected: %)', label, split_part(SQLERRM, E'\n', 1);
end $$;

do $$
declare
  uid uuid;
  cid uuid;
  mid uuid;
  n int;
begin
  -- A new auth user must get a profile automatically.
  insert into auth.users (email, raw_user_meta_data)
    values ('john@example.com', '{"display_name":"John"}'::jsonb) returning id into uid;
  select count(*) into n from profiles where user_id = uid;
  perform t('signup creates a profile row', n = 1);
  select count(*) into n from profiles where user_id = uid and display_name = 'John';
  perform t('display_name carried from signup metadata', n = 1);

  -- Defaults the app relies on.
  select count(*) into n from profiles where user_id = uid
    and tone_preference = 'secular' and meditation_length_pref = 10
    and timezone = 'UTC' and reference_events_by_name = false
    and is_admin = false and family_mode = false
    and generation_failures = 0;
  perform t('profile defaults are as the app expects', n = 1);

  -- The spec's requirement: a challenge row must be insertable with only
  -- slug, title, invitation, category, effort, context, audience.
  insert into challenges (slug, title, invitation, category, effort, context, audience)
    values ('t-minimal', 'Minimal', 'Do the thing.', 'presence', 1, 'anywhere', 'both')
    returning id into cid;
  select count(*) into n from challenges where id = cid
    and cost = 'none' and requires_others = false and weight = 1 and active = true;
  perform t('challenge valid with only the 7 required fields', n = 1);

  -- One meditation per user per local date.
  insert into daily_meditations (user_id, local_date, script_text, why_today, tone_used, length_used)
    values (uid, '2026-09-12', 'script', 'because', 'secular', 10) returning id into mid;
  perform t('meditation inserts', mid is not null);
  select count(*) into n from daily_meditations where id = mid and audio_status = 'pending' and audio_attempts = 0;
  perform t('audio starts pending with zero attempts', n = 1);

  -- The enum value added in 0003 must actually be usable.
  update daily_meditations set audio_status = 'synthesizing' where id = mid;
  select count(*) into n from daily_meditations where id = mid and audio_status = 'synthesizing';
  perform t('audio_status accepts synthesizing', n = 1);

  -- updated_at trigger.
  -- NOTE: the updated_at trigger uses now(), which is the *transaction*
  -- timestamp, so it cannot be observed to change inside a single DO block --
  -- pg_sleep does not advance it. Assert the trigger exists here and check the
  -- timestamp actually moves from separate transactions (see the runner).
  select count(*) into n from pg_trigger
    where tgrelid = 'profiles'::regclass and tgname = 'profiles_set_updated_at';
  perform t('updated_at trigger is installed on profiles', n = 1);

  -- Daily Light row + its array default.
  insert into user_challenges (user_id, challenge_id, local_date)
    values (uid, cid, '2026-09-12');
  select count(*) into n from user_challenges where user_id = uid
    and status = 'offered' and skipped_challenge_ids = '{}';
  perform t('user_challenge defaults to offered with empty skip array', n = 1);

  -- The swap path writes into the array.
  update user_challenges set skipped_challenge_ids = array[cid]
    where user_id = uid and local_date = '2026-09-12';
  select cardinality(skipped_challenge_ids) into n from user_challenges
    where user_id = uid and local_date = '2026-09-12';
  perform t('skipped_challenge_ids accepts a uuid array', n = 1);

  -- Admin helper, with no JWT set.
  perform t('is_current_user_admin() is false when signed out', is_current_user_admin() = false);

  -- Cascade: deleting the auth user must clear everything.
  delete from auth.users where id = uid;
  select (select count(*) from profiles where user_id = uid)
       + (select count(*) from daily_meditations where user_id = uid)
       + (select count(*) from user_challenges where user_id = uid) into n;
  perform t('deleting a user cascades all their rows', n = 0);
end $$;

-- Constraints that must reject bad data.
select rejects('duplicate slug',
  $q$insert into challenges (slug,title,invitation,category,effort,context,audience)
     values ('t-minimal','Dup','x','presence',1,'anywhere','both')$q$);
select rejects('bad category',
  $q$insert into challenges (slug,title,invitation,category,effort,context,audience)
     values ('t-cat','X','x','nonsense',1,'anywhere','both')$q$);
select rejects('effort above 3',
  $q$insert into challenges (slug,title,invitation,category,effort,context,audience)
     values ('t-eff','X','x','presence',4,'anywhere','both')$q$);
select rejects('bad cost',
  $q$insert into challenges (slug,title,invitation,category,effort,cost,context,audience)
     values ('t-cost','X','x','presence',1,'large','anywhere','both')$q$);
select rejects('zero weight',
  $q$insert into challenges (slug,title,invitation,category,effort,context,audience,weight)
     values ('t-w','X','x','presence',1,'anywhere','both',0)$q$);
select rejects('meditation length not 5/10/15',
  $q$insert into profiles (user_id, meditation_length_pref) values (gen_random_uuid(), 7)$q$);
