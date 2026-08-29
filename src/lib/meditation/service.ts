/**
 * Orchestration: profile → calendar signal → script → audio → database row.
 *
 * Called from two places, and the difference matters:
 *   - the overnight cron, for every user whose local morning has arrived
 *   - the /today route, as a safety net when the cron missed someone
 *
 * Both go through ensureTodaysMeditation(), which is idempotent: the unique
 * index on (user_id, local_date) means a double-run cannot produce two
 * meditations for one day.
 */

import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { getTodaySignal } from "@/lib/calendar";
import { forStorage } from "@/lib/calendar/signal";
import { localDateString } from "@/lib/time";
import type { DailyMeditation, Profile } from "@/lib/types";
import { generateMeditation, estimateDurationSeconds } from "./generate";
import { synthesizeAndStore } from "./tts";

/** How many past reflections to feed back into generation. */
const REFLECTION_LOOKBACK = 3;

export interface EnsureResult {
  meditation: DailyMeditation;
  /** False when today's meditation already existed. */
  created: boolean;
}

/**
 * Get or create today's meditation for a user.
 *
 * Audio failure is deliberately non-fatal: a script with no audio is still a
 * usable practice (the client can read it, or speak it via Web Speech), whereas
 * throwing would leave the user with nothing at all.
 */
export async function ensureTodaysMeditation(
  profile: Profile,
): Promise<EnsureResult> {
  const supabase = createAdminClient();
  const localDate = localDateString(new Date(), profile.timezone);

  const { data: existing } = await supabase
    .from("daily_meditations")
    .select("*")
    .eq("user_id", profile.user_id)
    .eq("local_date", localDate)
    .maybeSingle();

  if (existing) {
    return { meditation: existing as DailyMeditation, created: false };
  }

  const signal = await getTodaySignal({
    userId: profile.user_id,
    localDate,
    timeZone: profile.timezone,
    includeTitles: profile.reference_events_by_name,
  });

  const { data: reflections } = await supabase
    .from("journal_entries")
    .select("reflection_text")
    .eq("user_id", profile.user_id)
    .not("reflection_text", "is", null)
    .order("created_at", { ascending: false })
    .limit(REFLECTION_LOOKBACK);

  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: profile.timezone,
    weekday: "long",
  }).format(new Date());

  const generated = await generateMeditation({
    displayName: profile.display_name,
    mantra: profile.mantra,
    lifeQuest: profile.life_quest,
    tone: profile.tone_preference,
    lengthMinutes: profile.meditation_length_pref,
    signal,
    weekday,
    referenceEventsByName: profile.reference_events_by_name,
    // Reversed so the model reads them oldest-first, matching the prompt's
    // description of the ordering.
    recentReflections: (reflections ?? [])
      .map((r) => r.reflection_text as string)
      .reverse(),
  });

  const { data: inserted, error: insertError } = await supabase
    .from("daily_meditations")
    .insert({
      user_id: profile.user_id,
      local_date: localDate,
      script_text: generated.script,
      why_today: generated.whyToday,
      // forStorage() drops event titles. Never persist the raw signal.
      calendar_signal: forStorage(signal),
      tone_used: profile.tone_preference,
      length_used: profile.meditation_length_pref,
      audio_status: "pending",
      audio_duration_seconds: estimateDurationSeconds(generated.script),
    })
    .select()
    .single();

  if (insertError || !inserted) {
    // A unique-violation here means a concurrent run won the race. Return
    // whatever it created rather than failing.
    if (insertError?.code === "23505") {
      const { data: raced } = await supabase
        .from("daily_meditations")
        .select("*")
        .eq("user_id", profile.user_id)
        .eq("local_date", localDate)
        .single();
      if (raced) return { meditation: raced as DailyMeditation, created: false };
    }
    throw new Error(
      `Failed to save meditation: ${insertError?.message ?? "unknown error"}`,
    );
  }

  const meditation = inserted as DailyMeditation;

  try {
    const audioPath = await synthesizeAndStore({
      userId: profile.user_id,
      meditationId: meditation.id,
      script: generated.script,
    });

    const { data: updated } = await supabase
      .from("daily_meditations")
      .update({
        audio_url: audioPath,
        audio_status: audioPath ? "ready" : "skipped",
      })
      .eq("id", meditation.id)
      .select()
      .single();

    return {
      meditation: (updated as DailyMeditation) ?? meditation,
      created: true,
    };
  } catch (error) {
    console.error("[meditation] audio synthesis failed:", error);
    await supabase
      .from("daily_meditations")
      .update({ audio_status: "failed" })
      .eq("id", meditation.id);

    return {
      meditation: { ...meditation, audio_status: "failed" },
      created: true,
    };
  }
}

/**
 * Mark today's session finished. Idempotent — re-listening does not restart or
 * double-count the streak.
 */
export async function markCompleted(
  userId: string,
  meditationId: string,
): Promise<void> {
  const supabase = createAdminClient();
  await supabase
    .from("daily_meditations")
    .update({ completed_at: new Date().toISOString() })
    .eq("id", meditationId)
    .eq("user_id", userId)
    .is("completed_at", null);
}
