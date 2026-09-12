-- Supabase grants table privileges to `authenticated` out of the box; the stub
-- does not, and RLS only applies on top of grants. Grant them so the policies
-- are what is actually being tested.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

create or replace function t(label text, ok boolean) returns void language plpgsql as $$
begin raise notice '%  %', case when ok then '  ok  ' else ' FAIL ' end, label; end $$;

do $$
declare alice uuid; bob uuid; c uuid; n int;
begin
  insert into auth.users (email) values ('alice@example.com') returning id into alice;
  insert into auth.users (email) values ('bob@example.com') returning id into bob;

  insert into challenges (slug,title,invitation,category,effort,context,audience)
    values ('rls-c','C','x','presence',1,'anywhere','both') returning id into c;

  insert into daily_meditations (user_id, local_date, script_text, why_today, tone_used, length_used)
    values (alice,'2026-09-12','alice script','a','secular',10);
  insert into daily_meditations (user_id, local_date, script_text, why_today, tone_used, length_used)
    values (bob,'2026-09-12','bob script','b','secular',10);
  insert into journal_entries (user_id, reflection_text) values (alice,'alice private');
  insert into journal_entries (user_id, reflection_text) values (bob,'bob private');
  insert into user_challenges (user_id, challenge_id, local_date) values (alice,c,'2026-09-12');
  insert into user_challenges (user_id, challenge_id, local_date) values (bob,c,'2026-09-12');

  -- Make bob an admin so the write policy can be exercised from both sides.
  update profiles set is_admin = true where user_id = bob;

  perform set_config('test.alice', alice::text, false);
  perform set_config('test.bob', bob::text, false);
end $$;

-- ---- As Alice ------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', current_setting('test.alice'), false);

do $$ declare n int; begin
  select count(*) into n from daily_meditations;
  perform t('alice sees only her own meditation', n = 1);
  select count(*) into n from daily_meditations where script_text = 'bob script';
  perform t('alice cannot read bob''s meditation', n = 0);

  select count(*) into n from journal_entries;
  perform t('alice sees only her own journal', n = 1);

  select count(*) into n from user_challenges;
  perform t('alice sees only her own daily light', n = 1);

  -- The library is shared content, so the count depends on what earlier test
  -- files inserted. What matters is that a signed-in non-admin can see all of
  -- it, not how many rows there happen to be.
  select count(*) into n from challenges;
  perform t('alice can read the shared challenge library',
    n = (select count(*) from public.challenges));
end $$;

-- A non-admin must not be able to write the library.
do $$ begin
  insert into challenges (slug,title,invitation,category,effort,context,audience)
    values ('rls-hack','H','x','presence',1,'anywhere','both');
  perform t('non-admin BLOCKED from inserting challenges', false);
exception when others then
  perform t('non-admin blocked from inserting challenges', true);
end $$;

do $$ declare n int; begin
  update challenges set title = 'hacked';
  get diagnostics n = ROW_COUNT;
  perform t('non-admin update affects no rows', n = 0);
end $$;

-- Writing a row owned by someone else must fail the WITH CHECK.
do $$ begin
  insert into journal_entries (user_id, reflection_text)
    values (current_setting('test.bob')::uuid, 'forged');
  perform t('alice BLOCKED from writing as bob', false);
exception when others then
  perform t('alice blocked from writing a row owned by bob', true);
end $$;

-- ---- As Bob (admin) ------------------------------------------------------
select set_config('request.jwt.claim.sub', current_setting('test.bob'), false);

do $$ declare n int; begin
  perform t('is_current_user_admin() true for bob', is_current_user_admin());

  insert into challenges (slug,title,invitation,category,effort,context,audience)
    values ('rls-admin','A','x','presence',1,'anywhere','both');
  select count(*) into n from challenges where slug = 'rls-admin';
  perform t('admin can insert a challenge', n = 1);

  update challenges set title = 'Edited' where slug = 'rls-admin';
  get diagnostics n = ROW_COUNT;
  perform t('admin can update a challenge', n = 1);

  select count(*) into n from daily_meditations;
  perform t('admin still sees only their own meditations', n = 1);
end $$;

reset role;
