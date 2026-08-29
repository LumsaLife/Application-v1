/**
 * Timezone helpers.
 *
 * "Today" in Lumsa always means the user's local today, never UTC. A user in
 * Auckland and a user in Los Angeles get different meditations at the same
 * instant, and the overnight cron has to know whose morning it currently is.
 *
 * These helpers use Intl rather than a date library — the arithmetic we need is
 * small and well-defined, and it keeps the dependency list honest.
 */

/**
 * Offset of `timeZone` from UTC at a given instant, in milliseconds.
 * Positive east of Greenwich. Correct across DST transitions because it asks
 * Intl what the wall clock actually reads at that instant.
 */
function tzOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const parts: Record<string, string> = {};
  for (const part of dtf.formatToParts(instant)) {
    parts[part.type] = part.value;
  }

  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    // Intl can emit "24" for midnight in some locales/engines; normalise it.
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );

  return asIfUtc - instant.getTime();
}

/** The user's local calendar date at `instant`, as "YYYY-MM-DD". */
export function localDateString(instant: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD, which is exactly what Postgres `date` wants.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** The user's local hour (0–23) at `instant`. Drives the generation cron. */
export function localHour(instant: Date, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      hour: "2-digit",
    }).format(instant),
  ) % 24;
}

/**
 * The UTC instants bounding a local calendar day.
 *
 * Two passes: the first guesses using the offset at UTC midnight, the second
 * corrects it using the offset actually in effect at the guessed instant. This
 * matters on DST boundaries, where those two offsets differ by an hour.
 */
export function localDayBounds(
  localDate: string,
  timeZone: string,
): { start: Date; end: Date } {
  const [year, month, day] = localDate.split("-").map(Number);
  const naiveMidnight = Date.UTC(year, month - 1, day, 0, 0, 0);

  let start = naiveMidnight - tzOffsetMs(new Date(naiveMidnight), timeZone);
  start = naiveMidnight - tzOffsetMs(new Date(start), timeZone);

  const naiveNext = Date.UTC(year, month - 1, day + 1, 0, 0, 0);
  let end = naiveNext - tzOffsetMs(new Date(naiveNext), timeZone);
  end = naiveNext - tzOffsetMs(new Date(end), timeZone);

  return { start: new Date(start), end: new Date(end) };
}

/** Minutes since local midnight for `instant`. Used to bucket the day. */
export function localMinutesSinceMidnight(
  instant: Date,
  timeZone: string,
): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);

  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;

  return (Number(map.hour) % 24) * 60 + Number(map.minute);
}

/** True when `timeZone` is a timezone Intl recognises. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * Consecutive-day streak ending today (or yesterday — a streak survives until
 * the end of the following day, so opening the app at 11pm doesn't punish you
 * for not having practised yet).
 *
 * `completedDates` must be local "YYYY-MM-DD" strings, any order.
 */
export function computeStreak(
  completedDates: string[],
  todayLocal: string,
): number {
  if (completedDates.length === 0) return 0;

  const days = new Set(completedDates);

  // Walk backwards from today. If today isn't done yet, the streak is still
  // alive as long as yesterday was — so start counting there instead.
  const cursor = new Date(`${todayLocal}T00:00:00Z`);
  if (!days.has(todayLocal)) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    if (!days.has(cursor.toISOString().slice(0, 10))) return 0;
  }

  let streak = 0;
  while (days.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}
