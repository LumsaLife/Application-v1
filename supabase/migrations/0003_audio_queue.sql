-- Split audio synthesis off from script generation.
--
-- Why: the two have very different time profiles. A Claude call runs 20-40s; an
-- ElevenLabs pass over a 15-minute script is four chunked requests and runs
-- 40-80s. Doing both inside one hourly cron meant a 300s Vercel function could
-- serve three or four users before dying, and everyone else fell through to
-- lazy generation — which is exactly what pre-generating overnight was meant to
-- avoid.
--
-- So daily_meditations becomes the queue. A row lands with audio_status
-- 'pending'; a separate worker claims it, synthesizes, and marks it ready.
-- No new infrastructure — the table we already have is the work list.

-- 'synthesizing' marks a row some worker has claimed, so the audio cron and a
-- user's own foreground request can't both pay ElevenLabs for the same script.
alter type audio_status add value if not exists 'synthesizing' before 'ready';

alter table daily_meditations
  -- Bounded retries. Without this, one permanently-failing row is retried by
  -- every audio run forever, burning quota on a script that will never work.
  add column audio_attempts smallint not null default 0,
  -- Set when a worker claims the row. Lets us reclaim rows whose worker died
  -- mid-synthesis instead of leaving them stuck in 'synthesizing'.
  add column audio_claimed_at timestamptz,
  -- Last failure, surfaced in the UI and useful when debugging a bad voice ID.
  add column audio_error text;

-- The audio worker's only query: find claimable rows, newest first. Partial so
-- it stays small — the vast majority of rows are 'ready' and never looked at
-- through this path again.
create index daily_meditations_audio_queue_idx
  on daily_meditations (created_at)
  where audio_status in ('pending', 'synthesizing');
