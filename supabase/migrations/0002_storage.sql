-- Audio storage for generated meditations.
--
-- The bucket is private. A meditation is written from someone's calendar and
-- their stated intention; it should not be readable by anyone who guesses a
-- URL. Playback goes through short-lived signed URLs minted server-side
-- (see getPlaybackUrl in src/lib/meditation/tts.ts).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'meditations',
  'meditations',
  false,
  52428800, -- 50 MB; a 15-minute MP3 at 128kbps is roughly 14 MB
  array['audio/mpeg']
)
on conflict (id) do nothing;

-- Objects are stored at <user_id>/<meditation_id>.mp3, so the first path
-- segment is the owner. Users may read their own audio; only the service role
-- (used by the generation cron) writes.
create policy "users read own meditation audio"
  on storage.objects for select
  using (
    bucket_id = 'meditations'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users delete own meditation audio"
  on storage.objects for delete
  using (
    bucket_id = 'meditations'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
