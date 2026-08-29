/**
 * Meditation generation — the Claude call.
 *
 * Kept separate from prompt.ts on purpose: this file is plumbing (model, retries,
 * parsing, cost accounting) and should change rarely. The prompt is the thing you
 * iterate on, and it lives next door.
 */

import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

import { env } from "@/lib/env";
import {
  MEDITATION_SYSTEM_PROMPT,
  buildUserMessage,
  type MeditationPromptInput,
} from "./prompt";

const MODEL = "claude-opus-5";

/**
 * Comfortably above what a 15-minute script needs (~1,200 words ≈ 1,800 tokens)
 * with room for adaptive thinking. Non-streaming is fine at this ceiling; the
 * SDK's default timeout covers it, and generation runs in a cron job where
 * nobody is watching a spinner.
 */
const MAX_TOKENS = 16_000;

const MeditationSchema = z.object({
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

export interface GeneratedMeditation {
  script: string;
  whyToday: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  };
}

let cachedClient: Anthropic | null = null;

function client(): Anthropic {
  cachedClient ??= new Anthropic({ apiKey: env.anthropicApiKey() });
  return cachedClient;
}

/**
 * Generate today's meditation script and its "why this today" line.
 *
 * Throws on API failure — the caller decides whether to retry or to fall back.
 */
export async function generateMeditation(
  input: MeditationPromptInput,
): Promise<GeneratedMeditation> {
  const message = await client().beta.messages.parse({
    model: MODEL,
    max_tokens: MAX_TOKENS,

    // The system prompt is a frozen constant, so this prefix is identical across
    // every user and every day. During the overnight cron burst that means one
    // cache write and then cache reads for the rest of the run. If
    // cache_read_input_tokens is ever 0 across a batch, something has started
    // interpolating per-user content into the system prompt — see prompt.ts.
    system: [
      {
        type: "text",
        text: MEDITATION_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],

    messages: [{ role: "user", content: buildUserMessage(input) }],

    // This SDK version wires auto-parsing to the top-level `output_format`
    // field; `output_config.format` is not what .parse() reads. Revisit when
    // upgrading the SDK.
    output_format: betaZodOutputFormat(MeditationSchema),
  });

  // Adaptive thinking is on by default for this model. Effort defaults to
  // "high"; if the daily bill grows, `output_config: { effort: "medium" }` is
  // the first lever to try — measure the output quality before keeping it.

  // This SDK version does not surface `stop_details`, so we cannot report the
  // refusal category — the stop_reason alone is what we get.
  if (message.stop_reason === "refusal") {
    throw new Error(
      "Generation was refused by the safety classifier. This usually means the " +
        "mantra or life quest contains something that tripped it.",
    );
  }

  if (!message.parsed_output) {
    throw new Error(
      `Claude returned no parseable output (stop_reason: ${message.stop_reason}).`,
    );
  }

  const { script, whyToday } = message.parsed_output;

  if (!script.trim() || !whyToday.trim()) {
    throw new Error("Claude returned an empty script or why-today line.");
  }

  return {
    script: script.trim(),
    whyToday: whyToday.trim(),
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: message.usage.cache_creation_input_tokens ?? 0,
    },
  };
}

/**
 * Strip break tags for on-screen display.
 *
 * The script is stored exactly as generated — tags and all — because the TTS
 * layer needs them. Anywhere the script is shown to a human, run it through here.
 */
export function scriptForDisplay(script: string): string {
  return script
    .replace(/<break\s+time="[^"]*"\s*\/?>/gi, "")
    // Collapse the blank lines the removed tags leave behind.
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Rough spoken duration, used before real audio exists. */
export function estimateDurationSeconds(script: string): number {
  const words = scriptForDisplay(script).split(/\s+/).filter(Boolean).length;
  const speechSeconds = (words / 105) * 60; // ~105 wpm for guided meditation

  let pauseSeconds = 0;
  for (const match of script.matchAll(/<break\s+time="([\d.]+)s"/gi)) {
    pauseSeconds += Number(match[1]) || 0;
  }

  return Math.round(speechSeconds + pauseSeconds);
}
