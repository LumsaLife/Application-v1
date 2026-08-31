"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { markCompleted } from "@/lib/meditation/service";
import { completeLight, skipLight } from "@/lib/challenges/service";
import { localDateString } from "@/lib/time";
import type { CalendarSignal, Mood, Profile } from "@/lib/types";

/** Called when playback reaches the end. Idempotent. */
export async function completeSession(meditationId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Not signed in" };

  await markCompleted(user.id, meditationId);
  revalidatePath("/today");
  return { ok: true as const };
}

/** Save the post-session reflection. Either field may be empty, but not both. */
export async function saveReflection(params: {
  meditationId: string;
  mood: Mood | null;
  reflectionText: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Not signed in" };

  const text = params.reflectionText.trim().slice(0, 2000);
  if (!text && !params.mood) {
    return { ok: false as const, error: "Nothing to save" };
  }

  const { error } = await supabase.from("journal_entries").insert({
    user_id: user.id,
    meditation_id: params.meditationId,
    reflection_text: text || null,
    mood: params.mood,
  });

  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/journal");
  revalidatePath("/today");
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Daily Light
// ---------------------------------------------------------------------------

/**
 * Load the profile plus today's calendar shape.
 *
 * The signal is read back off today's meditation row rather than re-derived
 * from the calendar API. It was computed hours ago by the same code, it is
 * already scoped to today, and hitting Google again just to re-roll an act of
 * kindness would be an absurd amount of work for the outcome.
 */
async function loadContext(): Promise<
  { profile: Profile; signal: CalendarSignal | null } | null
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profile) return null;

  const localDate = localDateString(new Date(), (profile as Profile).timezone);
  const { data: meditation } = await supabase
    .from("daily_meditations")
    .select("calendar_signal")
    .eq("user_id", user.id)
    .eq("local_date", localDate)
    .maybeSingle();

  return {
    profile: profile as Profile,
    signal: (meditation?.calendar_signal as CalendarSignal) ?? null,
  };
}

export async function markLightDone() {
  const context = await loadContext();
  if (!context) return { ok: false as const, error: "Not signed in" };

  const localDate = localDateString(new Date(), context.profile.timezone);
  const ok = await completeLight(context.profile.user_id, localDate);
  if (!ok) return { ok: false as const, error: "Couldn't save that." };

  revalidatePath("/today");
  return { ok: true as const };
}

export async function passOnLight() {
  const context = await loadContext();
  if (!context) return { ok: false as const, error: "Not signed in" };

  const result = await skipLight(context.profile, context.signal);
  revalidatePath("/today");

  if (!result) return { ok: false as const, error: "Couldn't save that." };

  return {
    ok: true as const,
    light: {
      title: result.challenge.title,
      invitation: result.challenge.invitation,
      status: result.userChallenge.status,
      canSwap: result.canSwap,
    },
  };
}
