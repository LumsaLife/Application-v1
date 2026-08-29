-- Back off after repeated generation failures.
--
-- Why: /today is force-dynamic and calls ensureTodaysScript on every render.
-- When generation throws — a safety classifier refusal on an unusual mantra, an
-- expired API key, a provider outage — no row is written, so the next page load
-- tries again. A user refreshing burns a Claude call each time, and a systemic
-- failure does it for every user on every request.
--
-- These columns let the generator refuse to retry inside a cooldown that widens
-- with each consecutive failure, and to show the user what actually went wrong
-- instead of an empty screen.

alter table profiles
  add column generation_failures smallint not null default 0,
  add column generation_failed_at timestamptz,
  add column generation_error text;

comment on column profiles.generation_failures is
  'Consecutive failed generation attempts. Reset to 0 on success. Drives the retry cooldown in ensureTodaysScript.';
