"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isValidTimeZone } from "@/lib/time";
import type { MeditationLength, TonePreference } from "@/lib/types";

export interface OnboardingPayload {
  displayName: string;
  mantra: string;
  lifeQuest: string;
  tone: TonePreference;
  length: MeditationLength;
  timezone: string;
}

/**
 * Save the onboarding answers and mark the profile complete.
 *
 * Runs as the signed-in user, so RLS enforces that they can only write their
 * own row — this action does not need to check ownership itself.
 */
export async function completeOnboarding(payload: OnboardingPayload) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // The timezone arrives from the browser, so treat it as untrusted input —
  // a bad value would break the generation cron for this user silently.
  const timezone = isValidTimeZone(payload.timezone) ? payload.timezone : "UTC";

  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: payload.displayName.trim().slice(0, 80),
      mantra: payload.mantra.trim().slice(0, 400),
      life_quest: payload.lifeQuest.trim().slice(0, 600),
      tone_preference: payload.tone,
      meditation_length_pref: payload.length,
      timezone,
      onboarded_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);

  if (error) {
    return { ok: false as const, error: error.message };
  }

  return { ok: true as const };
}
