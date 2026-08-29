/**
 * Pure text transforms for TTS.
 *
 * Split out of tts.ts so they can be tested without pulling in `server-only`
 * and the Supabase client. Nothing here does IO — it is all string and byte
 * arithmetic, which is exactly the kind of code that breaks quietly.
 */

/** ElevenLabs documents break tags up to 3s; longer values are unreliable. */
export const MAX_BREAK_SECONDS = 3;

/**
 * We request mp3_44100_128 — constant bitrate, which makes duration exactly
 * derivable from byte count. If you change the output format to anything VBR,
 * durationFromBytes() starts lying and nothing will tell you.
 */
export const MP3_BITRATE_BPS = 128_000;

const BREAK_TAG = /<break\s+time="([\d.]+)s"\s*\/?>/gi;

/**
 * Rewrite break tags so no single pause exceeds the provider's reliable limit.
 * A 7-second pause becomes 3s + 3s + 1s, which plays as one continuous silence.
 */
export function normalizeBreaks(script: string): string {
  return script.replace(BREAK_TAG, (_match, seconds: string) => {
    let remaining = Number(seconds) || 0;
    if (remaining <= MAX_BREAK_SECONDS) {
      return `<break time="${remaining}s" />`;
    }
    const tags: string[] = [];
    while (remaining > 0) {
      const slice = Math.min(remaining, MAX_BREAK_SECONDS);
      tags.push(`<break time="${slice}s" />`);
      remaining -= slice;
    }
    return tags.join(" ");
  });
}

/** Remove break tags entirely, for providers with no silence primitive. */
export function stripBreaks(script: string): string {
  return script.replace(BREAK_TAG, " ").replace(/[ \t]{2,}/g, " ").trim();
}

/** Total seconds of silence a script asks for. */
export function totalBreakSeconds(script: string): number {
  let total = 0;
  for (const match of script.matchAll(BREAK_TAG)) {
    total += Number(match[1]) || 0;
  }
  return total;
}

/**
 * Split on paragraph boundaries, keeping each chunk under the character limit.
 * Splitting mid-sentence would put an audible seam in the middle of a line.
 *
 * A single paragraph longer than the limit is returned whole rather than cut —
 * an over-long request is a better failure than a sentence sliced in half.
 */
export function chunkScript(script: string, limit: number): string[] {
  const paragraphs = script.split(/\n{2,}/).filter((p) => p.trim());
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (current && current.length + paragraph.length + 2 > limit) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current);

  return chunks.length > 0 ? chunks : [script];
}

/** Duration of constant-bitrate MP3 data, in seconds. */
export function durationFromBytes(bytes: number): number {
  return Math.round((bytes * 8) / MP3_BITRATE_BPS);
}
