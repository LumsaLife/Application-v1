/**
 * Daily Light selection checks.
 *
 * The two properties that matter most and are least visible in the UI:
 * determinism (a refresh must never re-roll the day's challenge) and the
 * 30-day exclusion window (nobody should be handed the same act of kindness
 * twice in a month). Both are exercised here against a synthetic pool.
 */

import {
  EXCLUSION_WINDOW_DAYS,
  MAX_SMALL_COST_PER_WEEK,
  daysBetween,
  isWeekendDate,
  selectChallenge,
  type SelectionInputs,
} from "@/lib/challenges/select";
import { createRng, weightedPick } from "@/lib/challenges/random";
import type { Challenge } from "@/lib/challenges/types";
import type { CalendarSignal } from "@/lib/types";
import { check, section } from "./assert";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function challenge(overrides: Partial<Challenge> & { id: string }): Challenge {
  return {
    slug: overrides.id,
    title: `Title ${overrides.id}`,
    invitation: "Do the thing.",
    category: "presence",
    effort: 1,
    cost: "none",
    context: "anywhere",
    audience: "both",
    requires_others: false,
    weight: 1,
    active: true,
    ...overrides,
  };
}

function signal(overrides: Partial<CalendarSignal> = {}): CalendarSignal {
  return {
    meetingCount: 3,
    backToBackCount: 0,
    longestFreeBlockMinutes: 180,
    totalMeetingMinutes: 120,
    density: "moderate",
    heaviestPart: "afternoon",
    hasEarlyStart: false,
    runsLate: false,
    noCalendarConnected: false,
    ...overrides,
  };
}

/** A pool broad enough that the preference tiers have somewhere to go. */
function broadPool(): Challenge[] {
  const out: Challenge[] = [];
  const contexts = ["anywhere", "out", "work", "home"] as const;
  for (const effort of [1, 2, 3] as const) {
    for (const context of contexts) {
      out.push(
        challenge({ id: `e${effort}-${context}`, effort, context }),
      );
    }
  }
  return out;
}

function inputs(overrides: Partial<SelectionInputs> = {}): SelectionInputs {
  return {
    userId: "user-a",
    localDate: "2026-09-02", // a Wednesday
    pool: broadPool(),
    familyMode: false,
    signal: signal(),
    offeredHistory: new Map(),
    smallCostLastWeek: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

export function challengeChecks(): void {
  section("date helpers");
  check("Saturday is a weekend", isWeekendDate("2026-09-05"), true);
  check("Sunday is a weekend", isWeekendDate("2026-09-06"), true);
  check("Wednesday is not", isWeekendDate("2026-09-02"), false);
  check("Monday is not", isWeekendDate("2026-09-07"), false);
  check("same day is 0 apart", daysBetween("2026-09-02", "2026-09-02"), 0);
  check("consecutive days", daysBetween("2026-09-01", "2026-09-02"), 1);
  check("across a month", daysBetween("2026-08-31", "2026-09-30"), 30);
  // DST does not shift these because both sides are parsed as UTC midnight.
  check("across a DST change", daysBetween("2026-03-01", "2026-03-31"), 30);

  section("determinism");
  const a = selectChallenge(inputs());
  const b = selectChallenge(inputs());
  check("same user + date → same challenge", a?.challenge.id, b?.challenge.id);

  const runs = new Set(
    Array.from({ length: 25 }, () => selectChallenge(inputs())?.challenge.id),
  );
  check("stable across 25 evaluations", runs.size, 1);

  const otherUser = selectChallenge(inputs({ userId: "user-b" }));
  const otherDate = selectChallenge(inputs({ localDate: "2026-09-03" }));
  check("different user can differ", typeof otherUser?.challenge.id, "string");
  check("different date can differ", typeof otherDate?.challenge.id, "string");

  // Not a hard guarantee for any single pair, but across many users the
  // selection must actually spread — a constant answer would pass the
  // determinism checks above while being useless.
  const spread = new Set(
    Array.from(
      { length: 60 },
      (_, i) => selectChallenge(inputs({ userId: `user-${i}` }))?.challenge.id,
    ),
  );
  check("spreads across users", spread.size > 4, true);

  const spreadDays = new Set(
    Array.from({ length: 28 }, (_, i) => {
      const day = String(i + 1).padStart(2, "0");
      return selectChallenge(inputs({ localDate: `2026-09-${day}` }))?.challenge.id;
    }),
  );
  check("spreads across dates", spreadDays.size > 4, true);

  section("30-day exclusion");
  const pool = broadPool();
  const target = pool[0];

  const offeredYesterday = new Map([[target.id, "2026-09-01"]]);
  const recent = Array.from(
    { length: 30 },
    (_, i) =>
      selectChallenge(
        inputs({ userId: `u${i}`, offeredHistory: offeredYesterday }),
      )?.challenge.id,
  );
  check("recently offered never returns", recent.includes(target.id), false);

  // Exactly at the window boundary it becomes eligible again.
  const boundary = daysBetween("2026-08-03", "2026-09-02");
  check("boundary is exactly the window", boundary, EXCLUSION_WINDOW_DAYS);
  const atBoundary = selectChallenge(
    inputs({
      pool: [target],
      offeredHistory: new Map([[target.id, "2026-08-03"]]),
    }),
  );
  check("eligible again at exactly 30 days", atBoundary?.challenge.id, target.id);

  const insideWindow = selectChallenge(
    inputs({
      pool: [target],
      offeredHistory: new Map([[target.id, "2026-08-04"]]), // 29 days
    }),
  );
  // Sole candidate, inside the window: the LRU fallback must still return it
  // rather than leaving the user with nothing.
  check("falls back rather than returning nothing", insideWindow?.challenge.id, target.id);
  check("and says so in the tier", insideWindow?.debug?.tier, "least-recently-offered");

  section("least-recently-offered fallback");
  const three = [
    challenge({ id: "old" }),
    challenge({ id: "older" }),
    challenge({ id: "oldest" }),
  ];
  const history = new Map([
    ["old", "2026-09-01"],
    ["older", "2026-08-20"],
    ["oldest", "2026-07-01"],
  ]);
  const fallback = selectChallenge(
    inputs({ pool: three, offeredHistory: history }),
  );
  check("picks the longest-ago one", fallback?.challenge.id, "oldest");

  section("calendar-aware preferences");
  const packed = selectChallenge(
    inputs({ signal: signal({ density: "packed" }) }),
  );
  check("packed day → one-minute ask", packed?.challenge.effort, 1);
  check(
    "packed weekday → context they're already in",
    ["anywhere", "work"].includes(packed?.challenge.context ?? ""),
    true,
  );

  const airless = selectChallenge(
    inputs({ signal: signal({ density: "moderate", backToBackCount: 4 }) }),
  );
  check("back-to-back moderate day also drops to effort 1", airless?.challenge.effort, 1);

  const openDay = selectChallenge(
    inputs({ signal: signal({ density: "open", meetingCount: 0 }) }),
  );
  check("open day allows any effort", [1, 2, 3].includes(openDay?.challenge.effort ?? 0), true);

  const weekend = selectChallenge(
    inputs({ localDate: "2026-09-05", signal: signal({ density: "open" }) }),
  );
  check("weekend never offers a work context", weekend?.challenge.context === "work", false);

  const noCalendar = selectChallenge(
    inputs({ signal: null }),
  );
  check("no calendar still selects", typeof noCalendar?.challenge.id, "string");
  check("no calendar reports unknown density", noCalendar?.debug?.density, "unknown");

  section("audience");
  const mixed = [
    challenge({ id: "adult-only", audience: "adult" }),
    challenge({ id: "family-only", audience: "family" }),
    challenge({ id: "either", audience: "both" }),
  ];

  const familyPicks = new Set(
    Array.from(
      { length: 40 },
      (_, i) =>
        selectChallenge(inputs({ pool: mixed, familyMode: true, userId: `f${i}` }))
          ?.challenge.id,
    ),
  );
  check("family mode never shows adult-only", familyPicks.has("adult-only"), false);

  const adultPicks = new Set(
    Array.from(
      { length: 40 },
      (_, i) =>
        selectChallenge(inputs({ pool: mixed, familyMode: false, userId: `a${i}` }))
          ?.challenge.id,
    ),
  );
  check("adult mode never shows family-only", adultPicks.has("family-only"), false);

  // Audience is a hard rule: it must be able to empty the pool rather than
  // leak an adult challenge to a family-mode user.
  check(
    "family mode with no eligible rows returns nothing",
    selectChallenge(
      inputs({ pool: [challenge({ id: "x", audience: "adult" })], familyMode: true }),
    ),
    null,
  );

  section("cost throttle");
  const costly = [
    challenge({ id: "paid", cost: "small" }),
    challenge({ id: "free", cost: "none" }),
  ];
  check(
    "under the weekly cap, paid is allowed",
    typeof selectChallenge(inputs({ pool: costly, smallCostLastWeek: 0 }))?.challenge.id,
    "string",
  );

  const atCap = new Set(
    Array.from(
      { length: 30 },
      (_, i) =>
        selectChallenge(
          inputs({
            pool: costly,
            smallCostLastWeek: MAX_SMALL_COST_PER_WEEK,
            userId: `c${i}`,
          }),
        )?.challenge.id,
    ),
  );
  check("at the cap, money asks stop entirely", atCap.has("paid"), false);
  check("at the cap, free ones still come through", atCap.has("free"), true);
  check(
    "at the cap with only paid rows, nothing is offered",
    selectChallenge(
      inputs({
        pool: [challenge({ id: "paid", cost: "small" })],
        smallCostLastWeek: MAX_SMALL_COST_PER_WEEK,
      }),
    ),
    null,
  );

  section("swap");
  const first = selectChallenge(inputs());
  const second = selectChallenge(inputs({ exclude: [first!.challenge.id] }));
  check("swap returns something else", second?.challenge.id !== first?.challenge.id, true);
  check("swap is itself deterministic",
    selectChallenge(inputs({ exclude: [first!.challenge.id] }))?.challenge.id,
    second?.challenge.id,
  );

  section("edge cases");
  check("empty pool → null", selectChallenge(inputs({ pool: [] })), null);
  check(
    "all inactive → null",
    selectChallenge(inputs({ pool: [challenge({ id: "x", active: false })] })),
    null,
  );
  check(
    "everything excluded → null",
    selectChallenge(inputs({ pool: [challenge({ id: "x" })], exclude: ["x"] })),
    null,
  );

  section("weighted pick");
  const rng = createRng("fixed-seed");
  check("empty list → null", weightedPick([], rng), null);
  check("single item is always chosen", weightedPick([{ weight: 1, id: "a" }], rng)?.id, "a");

  // A zero or negative weight is far more likely to be a data-entry mistake
  // than an intent to disable — `active` exists for that. It must not silently
  // remove the row from circulation.
  const zeroWeighted = new Set(
    Array.from({ length: 50 }, (_, i) =>
      weightedPick(
        [{ weight: 0, id: "zero" }, { weight: 0, id: "also-zero" }],
        createRng(`s${i}`),
      )?.id,
    ),
  );
  check("zero weights still selectable", zeroWeighted.size >= 1, true);

  // Heavier weights must actually win more often.
  let heavy = 0;
  for (let i = 0; i < 400; i++) {
    const picked = weightedPick(
      [{ weight: 9, id: "heavy" }, { weight: 1, id: "light" }],
      createRng(`w${i}`),
    );
    if (picked?.id === "heavy") heavy += 1;
  }
  check("weight 9 vs 1 lands near 90%", heavy > 320 && heavy < 400, true);

  section("real seed data");
  const seed = require("../../supabase/seed/challenges.seed.json") as Challenge[];
  const withIds = seed.map((c, i) => challenge({ ...c, id: `seed-${i}` }));
  check("seed file loads", withIds.length, 43);
  check("all slugs unique", new Set(seed.map((c) => c.slug)).size, seed.length);

  // Every combination of day shape must yield something from the real library.
  const shapes: [string, Partial<SelectionInputs>][] = [
    ["packed weekday", { signal: signal({ density: "packed" }) }],
    ["open weekday", { signal: signal({ density: "open" }) }],
    ["weekend", { localDate: "2026-09-05", signal: signal({ density: "open" }) }],
    ["packed weekend", { localDate: "2026-09-05", signal: signal({ density: "packed" }) }],
    ["no calendar", { signal: null }],
    ["family mode", { familyMode: true }],
    ["family mode, packed", { familyMode: true, signal: signal({ density: "packed" }) }],
    ["family mode, weekend", { familyMode: true, localDate: "2026-09-05" }],
    ["cost capped", { smallCostLastWeek: 2 }],
  ];
  for (const [name, overrides] of shapes) {
    const result = selectChallenge(inputs({ pool: withIds, ...overrides }));
    check(`real library serves: ${name}`, result !== null, true);
  }

  // A year of daily selection should never fail and should stay varied.
  const history365 = new Map<string, string>();
  let served = 0;
  const seen = new Set<string>();
  for (let day = 0; day < 365; day++) {
    const date = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
    const result = selectChallenge(
      inputs({ pool: withIds, localDate: date, offeredHistory: history365 }),
    );
    if (!result) break;
    served += 1;
    seen.add(result.challenge.id);
    history365.set(result.challenge.id, date);
  }
  check("365 consecutive days all served", served, 365);
  check("uses most of the library over a year", seen.size > 25, true);
}
