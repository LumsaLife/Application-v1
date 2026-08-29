import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureTodaysMeditation } from "@/lib/meditation/service";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { localHour } from "@/lib/time";
import type { Profile } from "@/lib/types";

/**
 * Overnight generation.
 *
 * Runs hourly. Each run picks up the users whose *local* clock has just passed
 * GENERATION_HOUR, so everyone wakes to a practice already written and narrated
 * regardless of timezone — one cron, twenty-four cohorts.
 *
 * Requires a Vercel Pro plan: Hobby allows one cron execution per day, which
 * cannot serve users in more than one timezone. On Hobby, either run this from
 * an external scheduler hitting the same URL, or switch to generating lazily on
 * first visit (the /today route already falls back to that).
 */

// Users whose local hour just became this are generated for.
const GENERATION_HOUR = 5;

/** Ceiling per invocation, so one run can't blow the function timeout. */
const MAX_USERS_PER_RUN = 60;

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const now = new Date();

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("*")
    .not("onboarded_at", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Filtering in application code rather than SQL: Postgres can do timezone
  // arithmetic, but the same Intl-based logic runs everywhere else in the app
  // and having one implementation of "what time is it for this user" is worth
  // more than pushing the filter into the query.
  const due = (profiles as Profile[]).filter(
    (profile) => localHour(now, profile.timezone) === GENERATION_HOUR,
  );

  const batch = due.slice(0, MAX_USERS_PER_RUN);
  const results = { attempted: batch.length, created: 0, existing: 0, failed: 0 };

  for (const profile of batch) {
    try {
      const { created } = await ensureTodaysMeditation(profile);
      if (created) results.created += 1;
      else results.existing += 1;
    } catch (generationError) {
      results.failed += 1;
      // One user's bad mantra or revoked calendar must not stop the batch.
      console.error(
        `[cron/generate] failed for user ${profile.user_id}:`,
        generationError,
      );
    }
  }

  if (due.length > MAX_USERS_PER_RUN) {
    console.warn(
      `[cron/generate] ${due.length - MAX_USERS_PER_RUN} users deferred past ` +
        `the per-run cap; they will be generated lazily on first visit.`,
    );
  }

  return NextResponse.json({ ok: true, hour: GENERATION_HOUR, ...results });
}
