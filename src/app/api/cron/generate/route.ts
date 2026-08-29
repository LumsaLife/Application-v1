import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureTodaysScript } from "@/lib/meditation/service";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { runBatch } from "@/lib/batch";
import { localHour } from "@/lib/time";
import type { Profile } from "@/lib/types";

/**
 * Overnight script generation.
 *
 * Runs hourly and picks up the users whose *local* clock has just passed
 * GENERATION_HOUR — one schedule, twenty-four cohorts. Writes the script and
 * leaves audio 'pending' for /api/cron/audio to synthesize.
 *
 * Requires Vercel Pro: Hobby allows one cron execution per day, which cannot
 * serve users in more than one timezone.
 */

/** Users whose local hour just became this are generated for. */
const GENERATION_HOUR = 5;

/**
 * Vercel's function ceiling for this route. Note the budget below stops us
 * *starting* work well before this, so an item already in flight can finish.
 */
export const maxDuration = 300;

/**
 * Stop claiming new users at 3m30s, leaving 90s of headroom for the slowest
 * in-flight Claude call. Whatever is left stays queued for the next hourly run
 * — and any user the cron never reaches still gets a script on first visit.
 */
const BUDGET_MS = 210_000;

/**
 * Claude calls are IO-bound and independent, so a handful in parallel fills the
 * budget far better than working through them one at a time. Kept modest to
 * stay clear of per-account rate limits.
 */
const CONCURRENCY = 4;

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
  // arithmetic, but the same Intl-based logic runs everywhere else in the app,
  // and one implementation of "what time is it for this user" is worth more
  // than pushing the filter into the query.
  const due = (profiles as Profile[]).filter(
    (profile) => localHour(now, profile.timezone) === GENERATION_HOUR,
  );

  const result = await runBatch({
    items: due,
    concurrency: CONCURRENCY,
    budgetMs: BUDGET_MS,
    label: "cron/generate",
    handler: async (profile) => {
      await ensureTodaysScript(profile);
    },
  });

  return NextResponse.json({ ok: true, hour: GENERATION_HOUR, due: due.length, ...result });
}
