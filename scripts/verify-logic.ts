/**
 * Logic checks for the two modules where a subtle bug is invisible in the UI:
 * local-date arithmetic (which the generation cron depends on) and calendar
 * signal derivation (which is the privacy boundary).
 *
 * Deliberately dependency-free and run with `npm run verify` rather than a test
 * framework — an MVP does not need a runner configured to assert thirty things.
 * If this grows past a hundred checks, replace it with vitest.
 */

import {
  computeStreak,
  localDateString,
  localDayBounds,
  localHour,
  localMinutesSinceMidnight,
} from "@/lib/time";
import { buildCalendarSignal, describeSignal, forStorage } from "@/lib/calendar/signal";
import {
  chunkScript,
  durationFromBytes,
  normalizeBreaks,
  stripBreaks,
  totalBreakSeconds,
} from "@/lib/meditation/script-chunking";
import { runBatch } from "@/lib/batch";
import { generationCooldownMs } from "@/lib/backoff";
import { check, failureCount, section } from "./checks/assert";
import { challengeChecks } from "./checks/challenges";
import { envChecks } from "./checks/env";
import type { NormalizedEvent } from "@/lib/calendar/signal";

section("timezone");
// 2026-08-29T03:30:00Z = Aug 28, 8:30pm in LA; Aug 29 3:30pm in Auckland
const t = new Date("2026-08-29T03:30:00Z");
check("LA local date", localDateString(t, "America/Los_Angeles"), "2026-08-28");
check("Auckland local date", localDateString(t, "Pacific/Auckland"), "2026-08-29");
check("LA local hour", localHour(t, "America/Los_Angeles"), 20);
check("UTC midnight hour", localHour(new Date("2026-08-29T00:00:00Z"), "UTC"), 0);

// DST boundary: US spring-forward is 2026-03-08. The local day is 23h long.
const dstBounds = localDayBounds("2026-03-08", "America/New_York");
check(
  "DST spring-forward day is 23h",
  (dstBounds.end.getTime() - dstBounds.start.getTime()) / 3600000,
  23,
);
const normalBounds = localDayBounds("2026-08-29", "America/New_York");
check(
  "normal day is 24h",
  (normalBounds.end.getTime() - normalBounds.start.getTime()) / 3600000,
  24,
);
check("day starts at local midnight", localDateString(normalBounds.start, "America/New_York"), "2026-08-29");

section("streaks");
check("empty", computeStreak([], "2026-08-29"), 0);
check("today only", computeStreak(["2026-08-29"], "2026-08-29"), 1);
check("three consecutive ending today", computeStreak(["2026-08-29","2026-08-28","2026-08-27"], "2026-08-29"), 3);
check("alive when today not yet done", computeStreak(["2026-08-28","2026-08-27"], "2026-08-29"), 2);
check("broken two days ago", computeStreak(["2026-08-26","2026-08-25"], "2026-08-29"), 0);
check("gap stops the count", computeStreak(["2026-08-29","2026-08-27","2026-08-26"], "2026-08-29"), 1);
check("crosses a month boundary", computeStreak(["2026-09-01","2026-08-31","2026-08-30"], "2026-09-01"), 3);

section("calendar signal");
const tz = "America/New_York";
function ev(startLocalHour: number, minutes: number, title = "Meeting"): NormalizedEvent {
  // Build a UTC instant corresponding to the given NY local hour on 2026-08-29 (EDT, UTC-4)
  const start = new Date(Date.UTC(2026, 7, 29, startLocalHour + 4, 0, 0));
  return { title, start, end: new Date(start.getTime() + minutes * 60000), isAllDay: false, isDeclined: false };
}

const empty = buildCalendarSignal([], tz, false);
check("no events → open", empty.density, "open");
check("no events → not 'no calendar'", empty.noCalendarConnected, false);

const packed = buildCalendarSignal(
  [ev(9, 60), ev(10, 60), ev(11, 60), ev(13, 60), ev(14, 60), ev(15, 60)],
  tz, false,
);
check("6 hours of meetings → packed", packed.density, "packed");
check("back-to-back count", packed.backToBackCount, 4); // 9-10-11 and 13-14-15
check("meeting count", packed.meetingCount, 6);
check("total minutes", packed.totalMeetingMinutes, 360);
// 9/10/11am vs 1/2/3pm is 180 min each way — a genuine tie, resolved to morning.
check("heaviest part (tie → morning)", packed.heaviestPart, "morning");
check(
  "heaviest part (afternoon-loaded)",
  buildCalendarSignal([ev(9, 30), ev(13, 60), ev(14, 60), ev(15, 60)], tz, false).heaviestPart,
  "afternoon",
);
check(
  "heaviest part (morning-loaded)",
  buildCalendarSignal([ev(9, 60), ev(10, 60), ev(15, 30)], tz, false).heaviestPart,
  "morning",
);
check("longest free block (11am-1pm gap)", packed.longestFreeBlockMinutes, 120);

const light = buildCalendarSignal([ev(14, 30)], tz, false);
check("one short meeting → light", light.density, "light");
check("free block before it (8am-2pm)", light.longestFreeBlockMinutes, 360);

// Overlapping meetings must merge, not double-count the busy time
const overlapping = buildCalendarSignal([ev(9, 120), ev(10, 60)], tz, false);
check("overlap → longest gap is 10am-6pm... actually 11am-6pm", overlapping.longestFreeBlockMinutes, 420);

// Declined and all-day events are excluded
const filtered = buildCalendarSignal(
  [
    { ...ev(9, 60), isDeclined: true },
    { ...ev(11, 60), isAllDay: true },
    ev(14, 60),
  ],
  tz, false,
);
check("declined + all-day excluded", filtered.meetingCount, 1);

section("privacy boundary");
const withTitles = buildCalendarSignal([ev(9, 60, "Performance review")], tz, true);
check("titles present when opted in", withTitles.eventTitles, ["Performance review"]);
const withoutTitles = buildCalendarSignal([ev(9, 60, "Performance review")], tz, false);
check("titles absent when not opted in", withoutTitles.eventTitles, undefined);
check("forStorage strips titles", forStorage(withTitles).eventTitles, undefined);
check("forStorage keeps the rest", forStorage(withTitles).meetingCount, 1);

section("describeSignal");
console.log("   packed:", describeSignal(packed));
console.log("   light: ", describeSignal(light));
console.log("   empty: ", describeSignal(empty));

// Wrapped rather than top-level await: tsx emits CJS here, which doesn't
// support it.
void (async () => {
  await scriptChecks();
  await batchChecks();
  cooldownChecks();
  challengeChecks();
  envChecks();

  const failures = failureCount();
  console.log(
    failures === 0 ? "\nALL CHECKS PASSED\n" : `\n${failures} CHECK(S) FAILED\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
})();

async function scriptChecks() {
  section("script chunking");

  // ElevenLabs caps a single break at ~3s, so longer pauses must be split into
  // a run of shorter tags that play as one continuous silence.
  check("short break untouched", normalizeBreaks('<break time="2s" />'), '<break time="2s" />');
  check("3s break untouched", normalizeBreaks('<break time="3s" />'), '<break time="3s" />');
  check(
    "7s break splits into 3+3+1",
    normalizeBreaks('<break time="7s" />'),
    '<break time="3s" /> <break time="3s" /> <break time="1s" />',
  );
  check(
    "6s break splits into 3+3 with no zero-length tail",
    normalizeBreaks('<break time="6s" />'),
    '<break time="3s" /> <break time="3s" />',
  );
  check(
    "split preserves total silence",
    totalBreakSeconds(normalizeBreaks('<break time="8s" />')),
    8,
  );
  check("decimal break survives", normalizeBreaks('<break time="1.5s" />'), '<break time="1.5s" />');

  check("stripBreaks removes tags", stripBreaks('Breathe. <break time="3s" /> Again.'), "Breathe. Again.");
  check("totalBreakSeconds sums", totalBreakSeconds('<break time="3s" /> x <break time="2.5s" />'), 5.5);

  section("chunking");
  const para = (n: number, len: number) => Array(n).fill("x".repeat(len)).join("\n\n");

  check("short script is one chunk", chunkScript(para(2, 100), 2400).length, 1);
  const many = chunkScript(para(10, 500), 2400);
  check("long script splits", many.length > 1, true);
  check("every chunk under limit", many.every((c) => c.length <= 2400), true);
  check(
    "no content lost",
    many.join("\n\n").replace(/\s/g, "").length,
    para(10, 500).replace(/\s/g, "").length,
  );
  // A single over-long paragraph has to go somewhere; sending it whole is a
  // better failure than slicing a sentence in half.
  check("oversized single paragraph kept whole", chunkScript("y".repeat(5000), 2400).length, 1);
  check("empty script yields one chunk", chunkScript("", 2400).length, 1);

  section("duration from CBR bytes");
  // 128 kbps = 16,000 bytes/sec.
  check("16000 bytes = 1s", durationFromBytes(16_000), 1);
  check("960000 bytes = 60s", durationFromBytes(960_000), 60);
  check("15 min ≈ 14.4MB", durationFromBytes(14_400_000), 900);
}

async function batchChecks() {
  section("batch runner");

  const fast = await runBatch({
    items: [1, 2, 3, 4, 5],
    concurrency: 2,
    budgetMs: 5000,
    label: "test",
    handler: async () => {},
  });
  check("processes everything within budget", [fast.succeeded, fast.failed, fast.deferred], [5, 0, 0]);

  // One bad item must never cost everyone else their practice.
  const withFailure = await runBatch({
    items: [1, 2, 3, 4],
    concurrency: 2,
    budgetMs: 5000,
    label: "test",
    handler: async (n) => {
      if (n === 2) throw new Error("boom");
    },
  });
  check("one failure doesn't stop the batch", [withFailure.succeeded, withFailure.failed], [3, 1]);

  // The whole point of budgeting by clock: stop claiming work we can't finish,
  // and report what's left rather than overrunning the function timeout.
  const budgeted = await runBatch({
    items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    concurrency: 1,
    budgetMs: 250,
    label: "test",
    handler: async () => {
      await new Promise((r) => setTimeout(r, 100));
    },
  });
  check("stops at the deadline", budgeted.deferred > 0, true);
  check("accounts for every item", budgeted.attempted + budgeted.deferred, 10);
  check("never exceeds budget by more than one item", budgeted.elapsedMs < 600, true);

  // Concurrency must actually overlap the waiting, or the budget buys nothing.
  const started = Date.now();
  await runBatch({
    items: [1, 2, 3, 4],
    concurrency: 4,
    budgetMs: 5000,
    label: "test",
    handler: async () => {
      await new Promise((r) => setTimeout(r, 150));
    },
  });
  check("concurrency overlaps work", Date.now() - started < 400, true);

  const empty = await runBatch({
    items: [] as number[],
    concurrency: 4,
    budgetMs: 5000,
    label: "test",
    handler: async () => {},
  });
  check("empty queue is a no-op", [empty.attempted, empty.deferred], [0, 0]);
}

function cooldownChecks() {
  section("generation backoff");
  const MIN = 60_000;

  check("no failures → no wait", generationCooldownMs(0), 0);
  check("negative is treated as none", generationCooldownMs(-1), 0);
  check("1 failure → 30m", generationCooldownMs(1), 30 * MIN);
  check("2 failures → 1h", generationCooldownMs(2), 60 * MIN);
  check("3 failures → 2h", generationCooldownMs(3), 120 * MIN);
  check("4 failures → 4h", generationCooldownMs(4), 240 * MIN);
  // Caps, so a broken profile is retried a few times a day rather than never.
  check("5 failures caps at 6h", generationCooldownMs(5), 360 * MIN);
  check("20 failures still 6h", generationCooldownMs(20), 360 * MIN);
  // Guards against overflow from an absurd counter value.
  check("no overflow at large counts", Number.isFinite(generationCooldownMs(200)), true);
}
