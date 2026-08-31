/**
 * Daily Light persistence.
 *
 * Runs on the user's own Supabase client rather than the service role: RLS
 * already scopes user_challenges to the owner and lets any signed-in user read
 * the library, so there is nothing here that needs to bypass it. Selection
 * itself lives in select.ts and stays pure — this module only fetches what that
 * needs and writes back what it decides.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { CalendarSignal, Profile } from "@/lib/types";
import { localDateString } from "@/lib/time";
import { EXCLUSION_WINDOW_DAYS, selectChallenge } from "./select";
import type { Challenge, TodaysLight, UserChallenge } from "./types";

/** Rolling window for the "money asks stay occasional" rule. */
const SMALL_COST_WINDOW_DAYS = 7;

/** One alternative per day, then the card rests. */
const MAX_SWAPS_PER_DAY = 1;

function daysAgo(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

interface HistoryRow {
  challenge_id: string;
  local_date: string;
  skipped_challenge_ids: string[];
}

/**
 * Everything selection needs about what this user has already been shown.
 *
 * Skipped challenges count as offered. Passing on something is still having
 * seen it, and re-offering it tomorrow would read as the app not listening.
 */
async function loadHistory(
  supabase: SupabaseClient,
  userId: string,
  localDate: string,
  pool: Challenge[],
): Promise<{ offeredHistory: Map<string, string>; smallCostLastWeek: number }> {
  const { data } = await supabase
    .from("user_challenges")
    .select("challenge_id, local_date, skipped_challenge_ids")
    .eq("user_id", userId)
    .gte("local_date", daysAgo(localDate, EXCLUSION_WINDOW_DAYS))
    .order("local_date", { ascending: false });

  const rows = (data ?? []) as HistoryRow[];
  const offeredHistory = new Map<string, string>();

  const remember = (challengeId: string, date: string) => {
    const existing = offeredHistory.get(challengeId);
    if (!existing || existing < date) offeredHistory.set(challengeId, date);
  };

  for (const row of rows) {
    remember(row.challenge_id, row.local_date);
    for (const skipped of row.skipped_challenge_ids ?? []) {
      remember(skipped, row.local_date);
    }
  }

  // Count offers, not completions — the rule is about how often Lumsa *asks*
  // for money, which is what would start to feel like an expectation.
  const costBySlug = new Map(pool.map((c) => [c.id, c.cost]));
  const weekStart = daysAgo(localDate, SMALL_COST_WINDOW_DAYS);

  let smallCostLastWeek = 0;
  for (const row of rows) {
    if (row.local_date < weekStart) continue;
    const ids = [row.challenge_id, ...(row.skipped_challenge_ids ?? [])];
    // A day counts once even if the swap was also a paid ask.
    if (ids.some((id) => costBySlug.get(id) === "small")) smallCostLastWeek += 1;
  }

  return { offeredHistory, smallCostLastWeek };
}

async function loadPool(supabase: SupabaseClient): Promise<Challenge[]> {
  const { data, error } = await supabase
    .from("challenges")
    .select("*")
    .eq("active", true);

  if (error) {
    console.error("[challenges] failed to load library:", error.message);
    return [];
  }
  return (data ?? []) as Challenge[];
}

async function hydrate(
  supabase: SupabaseClient,
  row: UserChallenge,
): Promise<TodaysLight | null> {
  const { data } = await supabase
    .from("challenges")
    .select("*")
    .eq("id", row.challenge_id)
    .maybeSingle();

  if (!data) return null;

  return {
    userChallenge: row,
    challenge: data as Challenge,
    canSwap:
      row.status !== "completed" &&
      (row.skipped_challenge_ids?.length ?? 0) < MAX_SWAPS_PER_DAY,
  };
}

/**
 * Get or choose today's Daily Light.
 *
 * Returns null when the library is empty or every challenge is excluded — the
 * Today screen then simply doesn't render the section. A missing act of
 * kindness is not an error worth showing anyone.
 */
export async function ensureTodaysLight(
  profile: Profile,
  signal: CalendarSignal | null,
): Promise<TodaysLight | null> {
  const supabase = await createClient();
  const localDate = localDateString(new Date(), profile.timezone);

  const { data: existing } = await supabase
    .from("user_challenges")
    .select("*")
    .eq("user_id", profile.user_id)
    .eq("local_date", localDate)
    .maybeSingle();

  if (existing) return hydrate(supabase, existing as UserChallenge);

  const pool = await loadPool(supabase);
  if (pool.length === 0) return null;

  const { offeredHistory, smallCostLastWeek } = await loadHistory(
    supabase,
    profile.user_id,
    localDate,
    pool,
  );

  const outcome = selectChallenge({
    userId: profile.user_id,
    localDate,
    pool,
    familyMode: profile.family_mode,
    signal,
    offeredHistory,
    smallCostLastWeek,
  });

  if (!outcome) return null;

  const { data: inserted, error } = await supabase
    .from("user_challenges")
    .insert({
      user_id: profile.user_id,
      challenge_id: outcome.challenge.id,
      local_date: localDate,
      status: "offered",
    })
    .select()
    .single();

  if (error || !inserted) {
    // A unique violation means a concurrent request already chose today's.
    // Read that one back rather than failing — both would have been valid.
    if (error?.code === "23505") {
      const { data: raced } = await supabase
        .from("user_challenges")
        .select("*")
        .eq("user_id", profile.user_id)
        .eq("local_date", localDate)
        .maybeSingle();
      if (raced) return hydrate(supabase, raced as UserChallenge);
    }
    console.error("[challenges] failed to record today's light:", error?.message);
    return null;
  }

  return {
    userChallenge: inserted as UserChallenge,
    challenge: outcome.challenge,
    canSwap: true,
  };
}

/** Mark today's light done. Idempotent. */
export async function completeLight(
  userId: string,
  localDate: string,
): Promise<boolean> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("user_challenges")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("local_date", localDate);

  if (error) {
    console.error("[challenges] complete failed:", error.message);
    return false;
  }
  return true;
}

/**
 * "Not today".
 *
 * The first pass offers one alternative. The second settles the day — the card
 * rests rather than dealing again, because an endless re-roll turns an
 * invitation into a slot machine.
 */
export async function skipLight(
  profile: Profile,
  signal: CalendarSignal | null,
): Promise<TodaysLight | null> {
  const supabase = await createClient();
  const localDate = localDateString(new Date(), profile.timezone);

  const { data: existingRow } = await supabase
    .from("user_challenges")
    .select("*")
    .eq("user_id", profile.user_id)
    .eq("local_date", localDate)
    .maybeSingle();

  if (!existingRow) return null;
  const current = existingRow as UserChallenge;

  // Nothing to skip — the day is already settled either way.
  if (current.status === "completed") return hydrate(supabase, current);

  const alreadySkipped = current.skipped_challenge_ids ?? [];
  const skipped = [...alreadySkipped, current.challenge_id];

  // Swap spent: record the skip and let the day rest.
  if (alreadySkipped.length >= MAX_SWAPS_PER_DAY) {
    const { data: rested } = await supabase
      .from("user_challenges")
      .update({ status: "skipped", skipped_challenge_ids: skipped })
      .eq("id", current.id)
      .select()
      .single();

    return rested ? hydrate(supabase, rested as UserChallenge) : null;
  }

  const pool = await loadPool(supabase);
  const { offeredHistory, smallCostLastWeek } = await loadHistory(
    supabase,
    profile.user_id,
    localDate,
    pool,
  );

  const outcome = selectChallenge({
    userId: profile.user_id,
    localDate,
    pool,
    familyMode: profile.family_mode,
    signal,
    offeredHistory,
    smallCostLastWeek,
    exclude: skipped,
  });

  // Nothing left to offer. Settle the day rather than showing an empty card.
  if (!outcome) {
    const { data: rested } = await supabase
      .from("user_challenges")
      .update({ status: "skipped", skipped_challenge_ids: skipped })
      .eq("id", current.id)
      .select()
      .single();

    return rested ? hydrate(supabase, rested as UserChallenge) : null;
  }

  const { data: swapped, error } = await supabase
    .from("user_challenges")
    .update({
      challenge_id: outcome.challenge.id,
      status: "offered",
      skipped_challenge_ids: skipped,
    })
    .eq("id", current.id)
    .select()
    .single();

  if (error || !swapped) {
    console.error("[challenges] swap failed:", error?.message);
    return null;
  }

  return {
    userChallenge: swapped as UserChallenge,
    challenge: outcome.challenge,
    canSwap: false,
  };
}
