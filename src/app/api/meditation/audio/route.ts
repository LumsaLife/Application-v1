import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { processAudioJob } from "@/lib/meditation/service";
import { getPlaybackUrl } from "@/lib/meditation/tts";
import type { AudioStatus } from "@/lib/types";

/**
 * Foreground audio synthesis and status polling.
 *
 * The audio cron runs every ten minutes, which is fine for the overnight batch
 * but too slow for someone who signed up this morning and is looking at a
 * "preparing narration" spinner. So the user's own request can drive synthesis
 * too — it goes through the same atomic claim as the cron, so whichever gets
 * there first does the work and the other just reports status.
 */

export const maxDuration = 300;

/** Ownership check via RLS: this client can only see the user's own rows. */
async function loadOwnedMeditation(meditationId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" as const, status: 401 };

  const { data } = await supabase
    .from("daily_meditations")
    .select("id, audio_status, audio_url, audio_duration_seconds")
    .eq("id", meditationId)
    .maybeSingle();

  if (!data) return { error: "Not found" as const, status: 404 };
  return { meditation: data };
}

interface AudioPayload {
  status: AudioStatus;
  url: string | null;
  durationSeconds: number | null;
}

async function payloadFor(row: {
  audio_status: AudioStatus;
  audio_url: string | null;
  audio_duration_seconds: number | null;
}): Promise<AudioPayload> {
  return {
    status: row.audio_status,
    url:
      row.audio_status === "ready" && row.audio_url
        ? await getPlaybackUrl(row.audio_url)
        : null,
    durationSeconds: row.audio_duration_seconds,
  };
}

/** Poll endpoint. Cheap — one indexed read plus a signed URL when ready. */
export async function GET(request: NextRequest) {
  const meditationId = request.nextUrl.searchParams.get("id");
  if (!meditationId) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const result = await loadOwnedMeditation(meditationId);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(await payloadFor(result.meditation));
}

/** Synthesize now, if this row is claimable. Blocks until done (~40-80s). */
export async function POST(request: NextRequest) {
  const { meditationId } = (await request.json()) as { meditationId?: string };
  if (!meditationId) {
    return NextResponse.json({ error: "Missing meditationId" }, { status: 400 });
  }

  const owned = await loadOwnedMeditation(meditationId);
  if ("error" in owned) {
    return NextResponse.json({ error: owned.error }, { status: owned.status });
  }

  // Already done, or terminally failed — nothing to do.
  if (owned.meditation.audio_status !== "pending") {
    return NextResponse.json(await payloadFor(owned.meditation));
  }

  await processAudioJob(meditationId);

  // Re-read: processAudioJob may have landed on ready, skipped, failed, or
  // (when another worker held the claim) left it untouched.
  const after = await loadOwnedMeditation(meditationId);
  if ("error" in after) {
    return NextResponse.json({ error: after.error }, { status: after.status });
  }

  return NextResponse.json(await payloadFor(after.meditation));
}
