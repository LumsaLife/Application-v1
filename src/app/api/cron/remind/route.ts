import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { emailConfigured, sendDailyReminder } from "@/lib/email";
import { localDateString, localHour } from "@/lib/time";
import type { Profile } from "@/lib/types";

/**
 * Daily reminder email.
 *
 * Runs hourly and mails the users whose local clock just passed REMINDER_HOUR —
 * two hours after generation, so the practice exists and the email can lead with
 * its "why this today" line.
 *
 * Users who have already practised today are skipped: a nudge to do something
 * you have done is the fastest way to teach someone to ignore your emails.
 */

const REMINDER_HOUR = 7;
const MAX_EMAILS_PER_RUN = 200;

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!emailConfigured()) {
    return NextResponse.json({ ok: true, skipped: "email not configured" });
  }

  const supabase = createAdminClient();
  const now = new Date();

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("reminder_email_enabled", true)
    .not("onboarded_at", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const due = (profiles as Profile[])
    .filter((profile) => localHour(now, profile.timezone) === REMINDER_HOUR)
    .slice(0, MAX_EMAILS_PER_RUN);

  const results = { attempted: due.length, sent: 0, skipped: 0, failed: 0 };

  for (const profile of due) {
    try {
      const localDate = localDateString(now, profile.timezone);

      const { data: meditation } = await supabase
        .from("daily_meditations")
        .select("why_today, completed_at")
        .eq("user_id", profile.user_id)
        .eq("local_date", localDate)
        .maybeSingle();

      // Nothing generated yet, or they have already sat today.
      if (!meditation || meditation.completed_at) {
        results.skipped += 1;
        continue;
      }

      // Auth emails live in auth.users, which is only reachable with the
      // service role — this is one of the few places that genuinely needs it.
      const { data: authUser } = await supabase.auth.admin.getUserById(
        profile.user_id,
      );
      const email = authUser.user?.email;
      if (!email) {
        results.skipped += 1;
        continue;
      }

      const sent = await sendDailyReminder({
        to: email,
        displayName: profile.display_name,
        whyToday: meditation.why_today,
        lengthMinutes: profile.meditation_length_pref,
      });

      if (sent) results.sent += 1;
      else results.failed += 1;
    } catch (sendError) {
      results.failed += 1;
      console.error(
        `[cron/remind] failed for user ${profile.user_id}:`,
        sendError,
      );
    }
  }

  return NextResponse.json({ ok: true, hour: REMINDER_HOUR, ...results });
}
