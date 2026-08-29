/**
 * Prompt preview CLI.
 *
 * Generates one meditation against fabricated inputs and prints it, so you can
 * iterate on src/lib/meditation/prompt.ts without signing up, connecting a
 * calendar, or waiting for a cron. This is the fast loop for the thing that
 * most determines whether Lumsa feels like Lumsa.
 *
 *   npm run preview
 *   npm run preview -- --tone buddhist --length 15 --density packed
 *   npm run preview -- --mantra "Begin again" --quest "Finish my dissertation"
 *   npm run preview -- --names            # SPECIFIC why-today mode
 *   npm run preview -- --prompt-only      # print the prompt, spend nothing
 *
 * Needs ANTHROPIC_API_KEY (read from .env.local if present). Every run without
 * --prompt-only costs a real API call.
 */

import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

import {
  MEDITATION_SYSTEM_PROMPT,
  buildUserMessage,
  type MeditationPromptInput,
} from "@/lib/meditation/prompt";
import {
  MAX_TOKENS,
  MODEL,
  MeditationSchema,
} from "@/lib/meditation/model-config";
import { estimateDurationSeconds } from "@/lib/meditation/duration";
import type { CalendarSignal, MeditationLength, TonePreference } from "@/lib/types";

// ---------------------------------------------------------------------------
// .env.local — Next loads this automatically, a bare script does not.
// ---------------------------------------------------------------------------
function loadEnvLocal() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;

  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue; // a real env var always wins
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
  }
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------
function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

/** Prebaked calendar shapes, so you can compare tone across days. */
const DENSITIES: Record<string, CalendarSignal> = {
  open: {
    meetingCount: 0,
    backToBackCount: 0,
    longestFreeBlockMinutes: 600,
    totalMeetingMinutes: 0,
    density: "open",
    heaviestPart: "none",
    hasEarlyStart: false,
    runsLate: false,
    noCalendarConnected: false,
  },
  light: {
    meetingCount: 2,
    backToBackCount: 0,
    longestFreeBlockMinutes: 240,
    totalMeetingMinutes: 90,
    density: "light",
    heaviestPart: "morning",
    hasEarlyStart: false,
    runsLate: false,
    noCalendarConnected: false,
  },
  moderate: {
    meetingCount: 4,
    backToBackCount: 1,
    longestFreeBlockMinutes: 120,
    totalMeetingMinutes: 210,
    density: "moderate",
    heaviestPart: "afternoon",
    hasEarlyStart: false,
    runsLate: false,
    noCalendarConnected: false,
  },
  packed: {
    meetingCount: 7,
    backToBackCount: 4,
    longestFreeBlockMinutes: 35,
    totalMeetingMinutes: 390,
    density: "packed",
    heaviestPart: "afternoon",
    hasEarlyStart: true,
    runsLate: true,
    noCalendarConnected: false,
  },
  none: {
    meetingCount: 0,
    backToBackCount: 0,
    longestFreeBlockMinutes: 600,
    totalMeetingMinutes: 0,
    density: "open",
    heaviestPart: "none",
    hasEarlyStart: false,
    runsLate: false,
    noCalendarConnected: true,
  },
};

const SAMPLE_TITLES = [
  "Performance review with Dana",
  "Sprint planning",
  "1:1 — Marcus",
  "Board prep",
];

function buildInput(): MeditationPromptInput {
  const densityKey = arg("density") ?? "packed";
  const signal = DENSITIES[densityKey];
  if (!signal) {
    console.error(
      `Unknown --density "${densityKey}". Options: ${Object.keys(DENSITIES).join(", ")}`,
    );
    process.exit(1);
  }

  const referenceEventsByName = flag("names");

  return {
    displayName: arg("name") ?? "Sam",
    mantra: arg("mantra") ?? "Begin again.",
    lifeQuest: arg("quest") ?? "Be more patient with my team.",
    tone: (arg("tone") ?? "secular") as TonePreference,
    lengthMinutes: Number(arg("length") ?? 10) as MeditationLength,
    signal: referenceEventsByName
      ? { ...signal, eventTitles: SAMPLE_TITLES }
      : signal,
    weekday: arg("weekday") ?? "Thursday",
    referenceEventsByName,
    recentReflections: flag("reflections")
      ? ["Rushed, but glad I sat.", "Calmer than yesterday.", "Distracted."]
      : undefined,
  };
}

// ---------------------------------------------------------------------------

function rule(label: string) {
  console.log(`\n\x1b[2m${"─".repeat(72)}\x1b[0m`);
  console.log(`\x1b[1m${label}\x1b[0m\n`);
}

async function main() {
  loadEnvLocal();

  const input = buildInput();
  const userMessage = buildUserMessage(input);

  rule("INPUT");
  console.log(userMessage);

  if (flag("prompt-only")) {
    rule("SYSTEM PROMPT");
    console.log(MEDITATION_SYSTEM_PROMPT);
    console.log(
      `\n\x1b[2mSystem prompt: ~${Math.round(MEDITATION_SYSTEM_PROMPT.length / 4)} tokens. ` +
        `No API call made.\x1b[0m\n`,
    );
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      "\nANTHROPIC_API_KEY is not set. Put it in .env.local, or use " +
        "--prompt-only to inspect the prompt without calling the API.\n",
    );
    process.exit(1);
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  console.log("\n\x1b[2mGenerating…\x1b[0m");
  const startedAt = Date.now();

  const message = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      {
        type: "text",
        text: MEDITATION_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userMessage }],
    output_format: betaZodOutputFormat(MeditationSchema),
  });

  if (!message.parsed_output) {
    console.error(`\nNo parseable output. stop_reason: ${message.stop_reason}\n`);
    process.exit(1);
  }

  const { script, whyToday } = message.parsed_output;

  rule("WHY THIS TODAY");
  console.log(whyToday);

  rule("SCRIPT");
  console.log(script);

  // The numbers that tell you whether the length target is actually landing.
  const words = script.replace(/<break[^>]*>/gi, " ").split(/\s+/).filter(Boolean).length;
  const breaks = [...script.matchAll(/<break\s+time="([\d.]+)s"/gi)];
  const silence = breaks.reduce((sum, m) => sum + Number(m[1]), 0);
  const target = { 5: 300, 10: 600, 15: 900 }[input.lengthMinutes];
  const estimated = estimateDurationSeconds(script);

  rule("MEASURED");
  console.log(`  words          ${words}`);
  console.log(`  break tags     ${breaks.length} (${silence}s of silence)`);
  console.log(
    `  est. duration  ${Math.floor(estimated / 60)}m ${estimated % 60}s ` +
      `\x1b[2m(target ${input.lengthMinutes}m — ${
        estimated > target * 1.15
          ? "LONG"
          : estimated < target * 0.85
            ? "SHORT"
            : "on target"
      })\x1b[0m`,
  );
  console.log(
    `  tokens         ${message.usage.input_tokens} in / ` +
      `${message.usage.output_tokens} out, ` +
      `${message.usage.cache_read_input_tokens ?? 0} cached`,
  );
  console.log(`  elapsed        ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  console.log(
    `  TTS cost       ~${script.replace(/<break[^>]*>/gi, "").length} ElevenLabs characters\n`,
  );
}

void main().catch((error) => {
  console.error("\nPreview failed:", error);
  process.exit(1);
});
