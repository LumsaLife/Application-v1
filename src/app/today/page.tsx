import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AppNav } from "@/components/AppNav";
import { ensureTodaysScript } from "@/lib/meditation/service";
import { scriptForDisplay, estimateDurationSeconds } from "@/lib/meditation/generate";
import { getPlaybackUrl } from "@/lib/meditation/tts";
import { describeSignal } from "@/lib/calendar/signal";
import { computeStreak, localDateString } from "@/lib/time";
import type { DailyMeditation, Profile } from "@/lib/types";
import { TodayView } from "./TodayView";

// Always current — a cached Today screen would show yesterday's practice.
export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profileRow?.onboarded_at) redirect("/onboarding");
  const profile = profileRow as Profile;

  /*
   * Script generation normally happens overnight in the cron. This call is the
   * safety net: a user who signed up this morning, or whose cron run failed,
   * still gets a practice — it just costs them the wait. When the cron did its
   * job, this is a single indexed lookup.
   *
   * Audio is deliberately NOT synthesized here. It would add 40-80s to a page
   * render. TodayView drives it separately and shows real progress.
   */
  let meditation: DailyMeditation | null = null;
  let generationError: string | null = null;

  try {
    const result = await ensureTodaysScript(profile);
    meditation = result.meditation;
  } catch (error) {
    console.error("[today] generation failed:", error);
    generationError =
      error instanceof Error ? error.message : "Something went wrong.";
  }

  const admin = createAdminClient();

  const todayLocal = localDateString(new Date(), profile.timezone);
  const { data: completions } = await admin
    .from("daily_meditations")
    .select("local_date")
    .eq("user_id", user.id)
    .not("completed_at", "is", null)
    .order("local_date", { ascending: false })
    .limit(400);

  const streak = computeStreak(
    (completions ?? []).map((row) => row.local_date as string),
    todayLocal,
  );

  const { count: journalCount } = meditation
    ? await admin
        .from("journal_entries")
        .select("id", { count: "exact", head: true })
        .eq("meditation_id", meditation.id)
    : { count: 0 };

  const audioUrl =
    meditation?.audio_status === "ready" && meditation.audio_url
      ? await getPlaybackUrl(meditation.audio_url)
      : null;

  const greeting = getGreeting(profile.timezone);

  return (
    <div className="min-h-dvh pb-24 sm:pb-10">
      <AppNav current="today" />

      <main className="mx-auto max-w-2xl px-6 pt-10 sm:pt-14">
        <div className="animate-fade-up space-y-10">
          <header className="space-y-2">
            <div className="flex items-baseline justify-between gap-4">
              <p className="text-[15px] text-muted">
                {greeting}
                {profile.display_name ? `, ${profile.display_name}` : ""}
              </p>
              {streak > 0 && <StreakBadge days={streak} />}
            </div>
            <h1 className="font-display text-[1.75rem] leading-tight text-text sm:text-[2rem]">
              {formatToday(profile.timezone)}
            </h1>
          </header>

          {generationError ? (
            <ErrorState message={generationError} />
          ) : meditation ? (
            <>
              <section className="space-y-3">
                <p className="text-[17px] leading-relaxed text-text">
                  {meditation.why_today}
                </p>
                <p className="text-[13px] text-faint">
                  {describeSignal(meditation.calendar_signal)} ·{" "}
                  {meditation.length_used} min
                </p>
              </section>

              <TodayView
                meditationId={meditation.id}
                initialAudioUrl={audioUrl}
                initialAudioStatus={meditation.audio_status}
                displayScript={scriptForDisplay(meditation.script_text)}
                estimatedSeconds={
                  meditation.audio_duration_seconds ??
                  estimateDurationSeconds(meditation.script_text)
                }
                alreadyCompleted={Boolean(meditation.completed_at)}
                alreadyJournaled={(journalCount ?? 0) > 0}
              />
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}

function StreakBadge({ days }: { days: number }) {
  return (
    <span className="shrink-0 rounded-full bg-gold-soft px-3 py-1 text-[13px] font-medium text-gold">
      {days} {days === 1 ? "day" : "days"}
    </span>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-6">
      <h2 className="font-display text-lg text-text">
        Today&rsquo;s practice didn&rsquo;t come through
      </h2>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        Refreshing usually sorts it. If it keeps happening, the details are
        below.
      </p>
      <p className="mt-3 font-mono text-[12px] leading-relaxed text-faint">
        {message}
      </p>
    </div>
  );
}

function getGreeting(timeZone: string): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      hour: "2-digit",
    }).format(new Date()),
  ) % 24;

  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function formatToday(timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());
}
