/**
 * Turning a calendar into a *shape*.
 *
 * The privacy promise Lumsa makes in the UI is that we read the user's calendar
 * to understand the rhythm of their day and store almost none of it. This module
 * is where that promise is kept: it takes full events in memory, reduces them to
 * a handful of numbers and buckets, and hands back a CalendarSignal.
 *
 * Event titles are the sensitive part. They are included in the signal only when
 * the user has explicitly opted in, and even then `forStorage()` strips them
 * before the signal is written to the database. They exist just long enough to
 * be passed to the model.
 */

import type { CalendarSignal } from "@/lib/types";
import { localMinutesSinceMidnight } from "@/lib/time";

/** A calendar event, normalised across Google and Microsoft. */
export interface NormalizedEvent {
  title: string;
  start: Date;
  end: Date;
  isAllDay: boolean;
  /** True when the user themselves declined. Excluded from the signal. */
  isDeclined: boolean;
}

/** Working-day window used for the "longest free block" calculation. */
const WORKDAY_START_MINUTES = 8 * 60; // 08:00
const WORKDAY_END_MINUTES = 18 * 60; // 18:00

/** A gap smaller than this doesn't count as breathing room. */
const MIN_MEANINGFUL_GAP_MINUTES = 25;

/** Meetings closer together than this count as back-to-back. */
const BACK_TO_BACK_THRESHOLD_MINUTES = 15;

export const EMPTY_SIGNAL: CalendarSignal = {
  meetingCount: 0,
  backToBackCount: 0,
  longestFreeBlockMinutes: WORKDAY_END_MINUTES - WORKDAY_START_MINUTES,
  totalMeetingMinutes: 0,
  density: "open",
  heaviestPart: "none",
  hasEarlyStart: false,
  runsLate: false,
  noCalendarConnected: true,
};

/**
 * Reduce a day's events to a CalendarSignal.
 *
 * @param events      Everything on the user's calendar for their local today.
 * @param timeZone    The user's IANA timezone — all bucketing is local.
 * @param includeTitles Whether the user opted into event-name references.
 */
export function buildCalendarSignal(
  events: NormalizedEvent[],
  timeZone: string,
  includeTitles: boolean,
): CalendarSignal {
  // All-day events (holidays, "OOO", birthdays) say nothing about the rhythm of
  // the day, and declined meetings aren't the user's problem.
  const timed = events
    .filter((e) => !e.isAllDay && !e.isDeclined)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  if (timed.length === 0) {
    return {
      ...EMPTY_SIGNAL,
      noCalendarConnected: false,
      ...(includeTitles ? { eventTitles: [] } : {}),
    };
  }

  const spans = timed.map((e) => ({
    startMin: localMinutesSinceMidnight(e.start, timeZone),
    endMin: localMinutesSinceMidnight(e.end, timeZone),
    title: e.title,
  }));

  // An event crossing local midnight would produce endMin < startMin. Clamp it
  // to the end of the day rather than letting it produce negative durations.
  for (const span of spans) {
    if (span.endMin < span.startMin) span.endMin = 24 * 60;
  }

  const totalMeetingMinutes = spans.reduce(
    (sum, s) => sum + Math.max(0, s.endMin - s.startMin),
    0,
  );

  let backToBackCount = 0;
  for (let i = 1; i < spans.length; i++) {
    const gap = spans[i].startMin - spans[i - 1].endMin;
    if (gap <= BACK_TO_BACK_THRESHOLD_MINUTES) backToBackCount += 1;
  }

  const longestFreeBlockMinutes = longestGapInWorkday(spans);

  // Weight each part of the day by how many minutes of it are spoken for.
  const buckets = { morning: 0, afternoon: 0, evening: 0 };
  for (const span of spans) {
    for (let m = span.startMin; m < span.endMin; m += 15) {
      if (m < 12 * 60) buckets.morning += 15;
      else if (m < 17 * 60) buckets.afternoon += 15;
      else buckets.evening += 15;
    }
  }

  const heaviestPart = (() => {
    const max = Math.max(buckets.morning, buckets.afternoon, buckets.evening);
    if (max === 0) return "none" as const;
    if (buckets.morning === max) return "morning" as const;
    if (buckets.afternoon === max) return "afternoon" as const;
    return "evening" as const;
  })();

  const signal: CalendarSignal = {
    meetingCount: spans.length,
    backToBackCount,
    longestFreeBlockMinutes,
    totalMeetingMinutes,
    density: classifyDensity(spans.length, totalMeetingMinutes, backToBackCount),
    heaviestPart,
    hasEarlyStart: spans[0].startMin < 9 * 60,
    runsLate: Math.max(...spans.map((s) => s.endMin)) > 18 * 60,
    noCalendarConnected: false,
  };

  if (includeTitles) {
    // Cap it. A 20-meeting day would otherwise flood the prompt, and the model
    // gets no more useful after the first handful.
    signal.eventTitles = spans.slice(0, 8).map((s) => s.title).filter(Boolean);
  }

  return signal;
}

/**
 * Longest uninterrupted stretch inside working hours.
 * Merges overlapping meetings first — two double-booked calls are one busy block.
 */
function longestGapInWorkday(
  spans: { startMin: number; endMin: number }[],
): number {
  const merged: { startMin: number; endMin: number }[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.startMin <= last.endMin) {
      last.endMin = Math.max(last.endMin, span.endMin);
    } else {
      merged.push({ ...span });
    }
  }

  let longest = 0;
  let cursor = WORKDAY_START_MINUTES;

  for (const block of merged) {
    if (block.endMin <= WORKDAY_START_MINUTES) continue;
    if (block.startMin >= WORKDAY_END_MINUTES) break;
    longest = Math.max(longest, block.startMin - cursor);
    cursor = Math.max(cursor, block.endMin);
  }
  longest = Math.max(longest, WORKDAY_END_MINUTES - cursor);

  return Math.max(0, longest);
}

/**
 * Coarse density bucket.
 *
 * Deliberately not a formula the user could reverse-engineer into a productivity
 * score — it exists to pick a tone, nothing more. Back-to-back meetings weigh
 * heavier than raw count, because that's what actually makes a day feel airless.
 */
function classifyDensity(
  count: number,
  totalMinutes: number,
  backToBack: number,
): CalendarSignal["density"] {
  if (count === 0) return "open";

  const hours = totalMinutes / 60;
  if (hours >= 5 || count >= 6 || backToBack >= 3) return "packed";
  if (hours >= 2.5 || count >= 3) return "moderate";
  return "light";
}

/**
 * Strip anything we promised not to keep, ahead of writing to the database.
 * Call this — not the raw signal — anywhere a CalendarSignal is persisted.
 */
export function forStorage(signal: CalendarSignal): CalendarSignal {
  const { eventTitles: _omitted, ...rest } = signal;
  void _omitted;
  return rest;
}

/**
 * Plain-language summary of the day's shape, used in the UI to show the user
 * exactly what Lumsa read. Never mentions titles.
 */
export function describeSignal(signal: CalendarSignal): string {
  if (signal.noCalendarConnected) return "No calendar connected";
  if (signal.meetingCount === 0) return "Nothing scheduled today";

  const parts = [
    `${signal.meetingCount} ${signal.meetingCount === 1 ? "event" : "events"}`,
  ];
  if (signal.backToBackCount > 0) {
    parts.push(`${signal.backToBackCount} back-to-back`);
  }
  if (signal.longestFreeBlockMinutes >= MIN_MEANINGFUL_GAP_MINUTES) {
    const hours = Math.floor(signal.longestFreeBlockMinutes / 60);
    const mins = signal.longestFreeBlockMinutes % 60;
    const label = hours > 0 ? `${hours}h${mins > 0 ? ` ${mins}m` : ""}` : `${mins}m`;
    parts.push(`longest free block ${label}`);
  }
  return parts.join(" · ");
}
