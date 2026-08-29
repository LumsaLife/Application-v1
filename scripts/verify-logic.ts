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
import type { NormalizedEvent } from "@/lib/calendar/signal";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${ok ? "" : `\n         got ${JSON.stringify(actual)}\n         want ${JSON.stringify(expected)}`}`);
}

console.log("\n--- timezone ---");
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

console.log("\n--- streaks ---");
check("empty", computeStreak([], "2026-08-29"), 0);
check("today only", computeStreak(["2026-08-29"], "2026-08-29"), 1);
check("three consecutive ending today", computeStreak(["2026-08-29","2026-08-28","2026-08-27"], "2026-08-29"), 3);
check("alive when today not yet done", computeStreak(["2026-08-28","2026-08-27"], "2026-08-29"), 2);
check("broken two days ago", computeStreak(["2026-08-26","2026-08-25"], "2026-08-29"), 0);
check("gap stops the count", computeStreak(["2026-08-29","2026-08-27","2026-08-26"], "2026-08-29"), 1);
check("crosses a month boundary", computeStreak(["2026-09-01","2026-08-31","2026-08-30"], "2026-09-01"), 3);

console.log("\n--- calendar signal ---");
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

console.log("\n--- privacy boundary ---");
const withTitles = buildCalendarSignal([ev(9, 60, "Performance review")], tz, true);
check("titles present when opted in", withTitles.eventTitles, ["Performance review"]);
const withoutTitles = buildCalendarSignal([ev(9, 60, "Performance review")], tz, false);
check("titles absent when not opted in", withoutTitles.eventTitles, undefined);
check("forStorage strips titles", forStorage(withTitles).eventTitles, undefined);
check("forStorage keeps the rest", forStorage(withTitles).meetingCount, 1);

console.log("\n--- describeSignal ---");
console.log("   packed:", describeSignal(packed));
console.log("   light: ", describeSignal(light));
console.log("   empty: ", describeSignal(empty));

console.log(failures === 0 ? "\nALL CHECKS PASSED\n" : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
