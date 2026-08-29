/**
 * Retry backoff.
 *
 * Pure so it can be tested without pulling in `server-only` and the Supabase
 * client — the shape of a backoff curve is exactly the kind of thing that is
 * easy to get wrong by an order of magnitude and hard to notice in production.
 */

const GENERATION_COOLDOWN_BASE_MS = 30 * 60 * 1000; // 30 minutes
const GENERATION_COOLDOWN_MAX_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * How long to wait before retrying generation after `failures` consecutive
 * failures. Doubles each time — 30m, 1h, 2h, 4h — and caps at 6 hours.
 *
 * The cap matters: a profile whose generation is permanently broken (a mantra
 * the safety classifier refuses, say) should still be retried a few times a day
 * in case the cause was upstream and has since been fixed, rather than being
 * abandoned forever.
 */
export function generationCooldownMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(
    GENERATION_COOLDOWN_BASE_MS * 2 ** (failures - 1),
    GENERATION_COOLDOWN_MAX_MS,
  );
}
