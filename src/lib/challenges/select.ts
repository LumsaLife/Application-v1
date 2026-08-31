/**
 * Choosing the day's Daily Light.
 *
 * Pure by design — no database, no clock, no environment. Everything it needs
 * arrives in SelectionInputs, which is what makes the determinism and the
 * exclusion window testable without a Supabase project.
 *
 * The shape of the algorithm: apply the hard rules as filters, then try a
 * sequence of increasingly relaxed preference tiers and take the first tier
 * that still has candidates. Preferences must never be able to empty the pool —
 * a user with a packed calendar and family mode on would otherwise get nothing
 * at all, which is a far worse outcome than getting a slightly ill-fitting act
 * of kindness.
 */

import type { CalendarSignal } from "@/lib/types";
import { createRng, weightedPick } from "./random";
import type {
  Challenge,
  ChallengeContext,
  ChallengeEffort,
} from "./types";

/** Don't repeat a challenge offered within this many days. */
export const EXCLUSION_WINDOW_DAYS = 30;

/** Money-based asks should feel occasional. Max per rolling week. */
export const MAX_SMALL_COST_PER_WEEK = 2;

export interface SelectionInputs {
  userId: string;
  /** The user's local date, "YYYY-MM-DD". */
  localDate: string;
  /** Active challenges. Inactive rows should already be filtered out. */
  pool: Challenge[];
  familyMode: boolean;
  /** Today's calendar shape, or null when no calendar is connected. */
  signal: CalendarSignal | null;
  /**
   * challengeId → the most recent local date it was offered on. Used both for
   * the exclusion window and for the least-recently-offered fallback.
   */
  offeredHistory: Map<string, string>;
  /** How many `cost: small` challenges were offered in the last 7 days. */
  smallCostLastWeek: number;
  /** Challenges already passed over today. */
  exclude?: string[];
}

export interface SelectionDebug {
  poolSize: number;
  afterAudience: number;
  afterCost: number;
  freshCount: number;
  preferredEffort: ChallengeEffort[];
  preferredContext: ChallengeContext[];
  isWeekend: boolean;
  density: CalendarSignal["density"] | "unknown";
  /** Which relaxation tier produced the answer. */
  tier: string;
  seed: string;
}

export interface SelectionOutcome {
  challenge: Challenge;
  /** Populated outside production only — the mechanics stay off the screen. */
  debug?: SelectionDebug;
}

/**
 * Is this local date a Saturday or Sunday?
 *
 * The date string is already local, so parsing it as UTC and reading the UTC
 * day is correct — and avoids the server's own timezone leaking in.
 */
export function isWeekendDate(localDate: string): boolean {
  const day = new Date(`${localDate}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

/** Whole days between two "YYYY-MM-DD" dates. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.POSITIVE_INFINITY;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Which efforts suit the day.
 *
 * A packed day gets the one-minute asks — anything more is a burden dressed as
 * a kindness. An open day can carry the ones that take real intent.
 */
function preferredEfforts(
  signal: CalendarSignal | null,
): ChallengeEffort[] {
  if (!signal || signal.noCalendarConnected) return [1, 2, 3];

  switch (signal.density) {
    case "packed":
      return [1];
    case "moderate":
      // Back-to-back is what actually makes a day airless, more than raw count.
      return signal.backToBackCount >= 3 ? [1] : [1, 2];
    case "light":
    case "open":
      return [1, 2, 3];
  }
}

/** Which settings suit the day. */
function preferredContexts(
  signal: CalendarSignal | null,
  isWeekend: boolean,
): ChallengeContext[] {
  if (isWeekend) {
    // Nobody is at work. A work-context ask on a Saturday is just noise.
    return ["anywhere", "out", "home"];
  }

  const packed =
    signal && !signal.noCalendarConnected && signal.density === "packed";

  // On a packed weekday the only realistic settings are wherever they already
  // are. On an ordinary weekday, anything goes — "home" still works in the
  // evening.
  return packed
    ? ["anywhere", "work"]
    : ["anywhere", "out", "work", "home"];
}

/**
 * Pick the day's challenge.
 *
 * Returns null only when the pool is genuinely empty after the hard rules —
 * which means either no active challenges exist, or every one of them is
 * excluded today. The caller renders nothing rather than an error.
 */
export function selectChallenge(
  inputs: SelectionInputs,
): SelectionOutcome | null {
  const {
    userId,
    localDate,
    pool,
    familyMode,
    signal,
    offeredHistory,
    smallCostLastWeek,
    exclude = [],
  } = inputs;

  const excluded = new Set(exclude);
  const isWeekend = isWeekendDate(localDate);

  // --- Hard rules ---------------------------------------------------------
  // These can empty the pool, and that is correct: a family-mode user must
  // never be shown an adult-only challenge just because the pool ran thin.

  const available = pool.filter((c) => c.active && !excluded.has(c.id));

  const audienceAllowed = familyMode
    ? new Set(["family", "both"])
    : new Set(["adult", "both"]);
  const afterAudience = available.filter((c) => audienceAllowed.has(c.audience));

  const allowSmallCost = smallCostLastWeek < MAX_SMALL_COST_PER_WEEK;
  const afterCost = allowSmallCost
    ? afterAudience
    : afterAudience.filter((c) => c.cost === "none");

  if (afterCost.length === 0) return null;

  // --- Recency ------------------------------------------------------------

  const fresh = afterCost.filter((c) => {
    const lastOffered = offeredHistory.get(c.id);
    if (!lastOffered) return true;
    return daysBetween(lastOffered, localDate) >= EXCLUSION_WINDOW_DAYS;
  });

  // --- Preference tiers, strictest first ----------------------------------

  const efforts = new Set(preferredEfforts(signal));
  const contexts = new Set(preferredContexts(signal, isWeekend));

  const tiers: { name: string; candidates: Challenge[] }[] = [
    {
      name: "effort+context",
      candidates: fresh.filter(
        (c) => efforts.has(c.effort) && contexts.has(c.context),
      ),
    },
    { name: "effort", candidates: fresh.filter((c) => efforts.has(c.effort)) },
    { name: "context", candidates: fresh.filter((c) => contexts.has(c.context)) },
    { name: "any-fresh", candidates: fresh },
    // Everything has been seen inside the window. This is expected rather than
    // exceptional — family mode has fewer eligible challenges than the window
    // has days — so fall back to whatever was offered longest ago.
    { name: "least-recently-offered", candidates: leastRecentlyOffered(afterCost, offeredHistory) },
  ];

  const tier = tiers.find((t) => t.candidates.length > 0);
  if (!tier) return null;

  // Seeded on user + date so the answer is stable across refreshes, and on the
  // number of skips so "Not today" genuinely re-rolls rather than returning
  // the same challenge with one fewer candidate.
  const seed = `${userId}:${localDate}:${exclude.length}`;
  const challenge = weightedPick(tier.candidates, createRng(seed));
  if (!challenge) return null;

  const outcome: SelectionOutcome = { challenge };

  // The mechanics never reach the user; this is for local debugging only.
  if (process.env.NODE_ENV !== "production") {
    outcome.debug = {
      poolSize: pool.length,
      afterAudience: afterAudience.length,
      afterCost: afterCost.length,
      freshCount: fresh.length,
      preferredEffort: [...efforts],
      preferredContext: [...contexts],
      isWeekend,
      density: signal && !signal.noCalendarConnected ? signal.density : "unknown",
      tier: tier.name,
      seed,
    };
  }

  return outcome;
}

/**
 * The challenges offered longest ago (never-offered ones first).
 *
 * Returns the whole tied-oldest group rather than a single row, so the weighted
 * pick still has something to choose between and two users in the same position
 * don't get identical fallbacks.
 */
function leastRecentlyOffered(
  candidates: Challenge[],
  offeredHistory: Map<string, string>,
): Challenge[] {
  if (candidates.length === 0) return [];

  const keyed = candidates.map((challenge) => ({
    challenge,
    // Never offered sorts oldest.
    lastOffered: offeredHistory.get(challenge.id) ?? "",
  }));

  const oldest = keyed.reduce(
    (min, entry) => (entry.lastOffered < min ? entry.lastOffered : min),
    keyed[0].lastOffered,
  );

  return keyed
    .filter((entry) => entry.lastOffered === oldest)
    .map((entry) => entry.challenge);
}
