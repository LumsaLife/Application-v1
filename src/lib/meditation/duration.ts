/**
 * Spoken-duration estimation.
 *
 * Lives outside generate.ts so tooling — the preview CLI, the checks — can
 * import it without pulling in `server-only` and the Anthropic client.
 * generate.ts re-exports it so application code still has one obvious place to
 * reach for it.
 */

import { stripBreaks, totalBreakSeconds } from "./script-chunking";

/** Words per minute for guided meditation — far slower than conversation. */
const SPOKEN_WPM = 105;

/**
 * Rough spoken duration of a script, used before real audio exists and as the
 * yardstick the preview CLI checks length targets against.
 */
export function estimateDurationSeconds(script: string): number {
  const words = stripBreaks(script).split(/\s+/).filter(Boolean).length;
  return Math.round((words / SPOKEN_WPM) * 60 + totalBreakSeconds(script));
}
