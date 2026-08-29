import { NextResponse, type NextRequest } from "next/server";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { findPendingAudio, processAudioJob } from "@/lib/meditation/service";
import { runBatch } from "@/lib/batch";

/**
 * The audio worker.
 *
 * Drains the synthesis queue — rows left 'pending' by script generation, plus
 * any 'synthesizing' row whose worker died mid-run. Runs every ten minutes so a
 * user who generates lazily at 9am isn't waiting an hour for narration.
 *
 * Kept separate from script generation because the two have very different time
 * profiles: a Claude call is 20-40s, an ElevenLabs pass over a 15-minute script
 * is 40-80s and is the dominant cost. Running both in one function meant a
 * single slow synthesis starved everyone else's script.
 */

export const maxDuration = 300;

/** Stop claiming new jobs at 3m30s, leaving headroom for the slowest in flight. */
const BUDGET_MS = 210_000;

/**
 * ElevenLabs rate-limits on *concurrent* requests per account, and each job is
 * itself several sequential chunk requests. Two at a time keeps us comfortably
 * inside that while still overlapping the waiting.
 */
const CONCURRENCY = 2;

/**
 * Upper bound on rows pulled from the queue. The budget is the real limit; this
 * just avoids dragging a huge backlog into memory to mostly ignore it.
 */
const QUEUE_FETCH_LIMIT = 40;

export async function GET(request: NextRequest) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const queue = await findPendingAudio(QUEUE_FETCH_LIMIT);

  const result = await runBatch({
    items: queue,
    concurrency: CONCURRENCY,
    budgetMs: BUDGET_MS,
    label: "cron/audio",
    handler: async (meditation) => {
      await processAudioJob(meditation.id);
    },
  });

  return NextResponse.json({ ok: true, queued: queue.length, ...result });
}
