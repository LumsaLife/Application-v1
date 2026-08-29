"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { markCompleted } from "@/lib/meditation/service";
import type { Mood } from "@/lib/types";

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
