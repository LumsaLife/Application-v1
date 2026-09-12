# Schema tests

These run the migrations and their guarantees against a **stock Postgres**, with
`00_supabase_stubs.sql` standing in for the bits Supabase provides (`auth.users`,
`auth.uid()`, `storage.*`, and the `authenticated` role). It is not a Supabase
emulator — just enough surface for the DDL, constraints, triggers and policies
to be exercised for real.

Worth having because RLS is the only thing standing between one user's
meditations and another's, and a policy that silently does nothing looks exactly
like a policy that works.

## Running

Needs a local Postgres (16+). With one running on port 5433:

```bash
psql -f supabase/tests/00_supabase_stubs.sql
for f in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -f "$f"; done
psql -f supabase/tests/01_schema.test.sql
psql -f supabase/tests/02_rls.test.sql
```

Each test prints `ok` / `FAIL` lines.

## What they cover

**01_schema** — the signup trigger creates a profile; profile defaults match what
the app assumes; a `challenges` row is valid with only the seven required fields
(the admin-by-table-editor requirement); `audio_status` accepts `synthesizing`;
`skipped_challenge_ids` defaults to an empty array; deleting an auth user
cascades everything; and every CHECK constraint rejects what it should.

**02_rls** — a user sees only their own meditations, journal entries and daily
lights; cannot read or forge another user's rows; can read the shared challenge
library; and cannot write to it. An admin can write the library but still sees
only their own personal rows.

## One gotcha

`updated_at` uses `now()`, which is the *transaction* timestamp. It cannot be
observed changing inside a single `DO` block, because `pg_sleep` does not
advance it. The test asserts the trigger is installed; to watch the value move,
update from two separate transactions.
