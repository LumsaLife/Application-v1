/**
 * Orchestration, in two phases.
 *
 * Phase 1 — the script. A Claude call, 20-40s. Cheap enough that a user can
 * wait for it in the foreground if the cron missed them.
 *
 * Phase 2 — the audio. Four chunked ElevenLabs requests for a 15-minute script,
 * 40-80s, and the dominant cost. Queued rather than inline, because binding it
 * to phase 1 meant a 300s function served three or four users before dying.
 *
 * The `daily_meditations` table is the queue: a row lands 'pending', a worker
 * claims it into 'synthesizing', and it ends 'ready', 'failed', or 'skipped'.
 * Both the audio cron and a user's own foreground request drain the same queue
 * through the same atomic claim, so neither can pay ElevenLabs twice for one
 * script.
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

/** Give up on a script's audio after this many failures. */
export const MAX_AUDIO_ATTEMPTS = 3;

/**
 * A row claimed longer ago than this had its worker die mid-synthesis (function
 * timeout, deploy). Comfortably longer than the slowest legitimate synthesis.
 */
const CLAIM_STALE_MS = 10 * 60 * 1000;

export interface EnsureResult {
  meditation: DailyMeditation;
  /** False when today's script already existed. */
  created: boolean;
}

// ---------------------------------------------------------------------------
// Phase 1 — the script
// ---------------------------------------------------------------------------

/**
 * Get or create today's script for a user. Does NOT synthesize audio — the row
 * is left 'pending' for the audio worker.
 *
 * Idempotent: the unique index on (user_id, local_date) means a double-run
 * cannot produce two meditations for one day.
 */
export async function ensureTodaysScript(
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
    // Reversed so the model reads them oldest-first, matching the prompt.
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
      // Replaced with the real duration once audio exists.
      audio_duration_seconds: estimateDurationSeconds(generated.script),
    })
    .select()
    .single();

  if (insertError || !inserted) {
    // A unique violation means a concurrent run won the race. Return whatever
    // it created rather than failing.
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

  return { meditation: inserted as DailyMeditation, created: true };
}

// ---------------------------------------------------------------------------
// Phase 2 — the audio queue
// ---------------------------------------------------------------------------

/**
 * Atomically claim a row for synthesis.
 *
 * The `.eq("audio_status", ...)` in the update is the lock: Postgres applies it
 * under row-level locking, so exactly one caller can move a row out of
 * 'pending'. Returns false when someone else got there first.
 */
async function claimForSynthesis(
  meditationId: string,
  from: "pending" | "synthesizing",
): Promise<DailyMeditation | null> {
  const supabase = createAdminClient();

  const query = supabase
    .from("daily_meditations")
    .update({
      audio_status: "synthesizing",
      audio_claimed_at: new Date().toISOString(),
    })
    .eq("id", meditationId)
    .eq("audio_status", from);

  // Reclaiming a stale row additionally requires the old claim to be expired,
  // so we can't steal a job from a worker that is still running.
  const scoped =
    from === "synthesizing"
      ? query.lt(
          "audio_claimed_at",
          new Date(Date.now() - CLAIM_STALE_MS).toISOString(),
        )
      : query;

  const { data } = await scoped.select().maybeSingle();
  return (data as DailyMeditation) ?? null;
}

/**
 * Synthesize audio for one meditation, if it is claimable.
 *
 * Safe to call concurrently from the cron and from a user's own request —
 * whoever loses the claim simply returns without doing work.
 */
export async function processAudioJob(
  meditationId: string,
): Promise<{ status: "done" | "skipped" | "not-claimed" | "failed" }> {
  const supabase = createAdminClient();

  const claimed =
    (await claimForSynthesis(meditationId, "pending")) ??
    (await claimForSynthesis(meditationId, "synthesizing"));

  if (!claimed) return { status: "not-claimed" };

  try {
    const stored = await synthesizeAndStore({
      userId: claimed.user_id,
      meditationId: claimed.id,
      script: claimed.script_text,
    });

    if (!stored) {
      // No TTS provider configured. Not a failure — the client falls back to
      // Web Speech, and retrying would never help.
      await supabase
        .from("daily_meditations")
        .update({ audio_status: "skipped", audio_claimed_at: null })
        .eq("id", claimed.id);
      return { status: "skipped" };
    }

    await supabase
      .from("daily_meditations")
      .update({
        audio_url: stored.path,
        audio_status: "ready",
        audio_duration_seconds: stored.durationSeconds,
        audio_claimed_at: null,
        audio_error: null,
      })
      .eq("id", claimed.id);

    return { status: "done" };
  } catch (error) {
    const attempts = claimed.audio_attempts + 1;
    const message = error instanceof Error ? error.message : String(error);

    // Back to 'pending' while retries remain, so the next run picks it up.
    // 'failed' is terminal and stops us burning quota on a hopeless row.
    await supabase
      .from("daily_meditations")
      .update({
        audio_status: attempts >= MAX_AUDIO_ATTEMPTS ? "failed" : "pending",
        audio_attempts: attempts,
        audio_claimed_at: null,
        audio_error: message.slice(0, 500),
      })
      .eq("id", claimed.id);

    console.error(
      `[meditation] audio attempt ${attempts}/${MAX_AUDIO_ATTEMPTS} failed ` +
        `for ${claimed.id}:`,
      error,
    );

    return { status: "failed" };
  }
}

/**
 * Rows waiting for audio: fresh 'pending' work, plus 'synthesizing' rows whose
 * worker died. Newest first, so today's practices are served before any backlog.
 */
export async function findPendingAudio(limit: number): Promise<DailyMeditation[]> {
  const supabase = createAdminClient();
  const staleBefore = new Date(Date.now() - CLAIM_STALE_MS).toISOString();

  const { data, error } = await supabase
    .from("daily_meditations")
    .select("*")
    .or(
      `audio_status.eq.pending,and(audio_status.eq.synthesizing,audio_claimed_at.lt.${staleBefore})`,
    )
    .lt("audio_attempts", MAX_AUDIO_ATTEMPTS)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[meditation] failed to query audio queue:", error.message);
    return [];
  }
  return (data ?? []) as DailyMeditation[];
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

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
