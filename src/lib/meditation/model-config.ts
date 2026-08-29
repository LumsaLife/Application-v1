/**
 * Model configuration and output schema.
 *
 * Pure — no SDK client, no `server-only` — so both the production generator and
 * the prompt-preview CLI can import it. They must agree on model, token ceiling,
 * and output shape, or the preview stops predicting what users actually get.
 */

import { z } from "zod";

export const MODEL = "claude-opus-5";

/**
 * Comfortably above what a 15-minute script needs (~1,200 words ≈ 1,800 tokens)
 * with room for adaptive thinking. Non-streaming is fine at this ceiling; the
 * SDK's default timeout covers it, and generation runs in the background where
 * nobody is watching a spinner.
 */
export const MAX_TOKENS = 16_000;

export const MeditationSchema = z.object({
  script: z
    .string()
    .describe(
      "The full meditation script, plain prose with paragraph breaks and " +
        '<break time="Ns" /> tags for silence. No headings or markdown.',
    ),
  whyToday: z
    .string()
    .describe(
      "One sentence explaining what in today's calendar shaped this practice.",
    ),
});

export type MeditationOutput = z.infer<typeof MeditationSchema>;
