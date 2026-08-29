"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isValidTimeZone, localDateString } from "@/lib/time";
import type {
  MeditationLength,
  ThemePreference,
  TonePreference,
} from "@/lib/types";

export interface SettingsPayload {
  displayName: string;
  mantra: string;
  lifeQuest: string;
  tone: TonePreference;
  length: MeditationLength;
  referenceEventsByName: boolean;
  theme: ThemePreference;
  reminderEmailEnabled: boolean;
  timezone: string;
}

export async function updateSettings(payload: SettingsPayload) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Not signed in" };

  const timezone = isValidTimeZone(payload.timezone) ? payload.timezone : "UTC";

  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: payload.displayName.trim().slice(0, 80),
      mantra: payload.mantra.trim().slice(0, 400),
      life_quest: payload.lifeQuest.trim().slice(0, 600),
      tone_preference: payload.tone,
      meditation_length_pref: payload.length,
      reference_events_by_name: payload.referenceEventsByName,
      theme_preference: payload.theme,
      reminder_email_enabled: payload.reminderEmailEnabled,
      timezone,
      // Editing your inputs is the signal that you've fixed whatever the
      // generator choked on, so clear the backoff rather than making someone
      // who just corrected their mantra wait out a six-hour cooldown.
      generation_failures: 0,
      generation_failed_at: null,
      generation_error: null,
    })
    .eq("user_id", user.id);

  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/settings");
  revalidatePath("/today");
  return { ok: true as const };
}

/**
 * Delete today's meditation so the next visit to /today regenerates it.
 *
 * Exists because preference changes don't retroactively rewrite a practice that
 * was already generated this morning — without this, "change your tone" appears
 * to do nothing until tomorrow.
 */
export async function regenerateToday() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Not signed in" };

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("user_id", user.id)
    .single();

  // An explicit regenerate is a deliberate retry — clear the backoff too.
  await supabase
    .from("profiles")
    .update({
      generation_failures: 0,
      generation_failed_at: null,
      generation_error: null,
    })
    .eq("user_id", user.id);

  const today = localDateString(new Date(), profile?.timezone ?? "UTC");

  const { error } = await supabase
    .from("daily_meditations")
    .delete()
    .eq("user_id", user.id)
    .eq("local_date", today);

  if (error) return { ok: false as const, error: error.message };

  revalidatePath("/today");
  return { ok: true as const };
}
