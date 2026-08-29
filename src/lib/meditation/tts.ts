/**
 * Text-to-speech.
 *
 * ElevenLabs is the default and the provider the voice settings below are tuned
 * for: it honours `<break time="Ns" />` tags, which is the whole reason the
 * prompt emits them. Silence is not decoration in a meditation — it is the
 * practice — and a provider that ignores break tags produces a script read
 * aloud rather than a session.
 *
 * OpenAI TTS is supported as a cheaper alternative, but it has no silence
 * primitive, so break tags are stripped and the pacing flattens. Treat it as a
 * budget fallback, not an equivalent.
 *
 * With neither key configured, generation stores the script with
 * audio_status='skipped' and the client falls back to the browser's Web Speech
 * API. That path is free and requires no account, but it sounds like a screen
 * reader — fine for local development, not for anyone you are trying to impress.
 */

import "server-only";

import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const AUDIO_BUCKET = "meditations";

/**
 * ElevenLabs documents break tags up to 3 seconds. Longer values are unreliable,
 * so we split a long pause into a run of shorter ones.
 */
const MAX_BREAK_SECONDS = 3;

/**
 * Characters per request. ElevenLabs accepts more, but shorter requests fail
 * less often and let us retry a single chunk instead of a 15-minute script.
 */
const CHUNK_CHAR_LIMIT = 2_400;

export interface SynthesisResult {
  audio: Buffer;
  contentType: string;
}

/** Voice settings tuned for slow, warm, unhurried narration. */
const ELEVENLABS_VOICE_SETTINGS = {
  // High stability keeps the delivery even. Meditation wants consistency;
  // expressive variation reads as performance and pulls attention outward.
  stability: 0.62,
  similarity_boost: 0.75,
  // Low style exaggeration — we want plain, not theatrical.
  style: 0.12,
  use_speaker_boost: true,
  // Slightly below natural pace. The single most effective setting here.
  speed: 0.88,
};

/**
 * Rewrite break tags so no single pause exceeds the provider's reliable limit.
 * A 7-second pause becomes 3s + 3s + 1s, which plays as one continuous silence.
 */
function normalizeBreaks(script: string): string {
  return script.replace(
    /<break\s+time="([\d.]+)s"\s*\/?>/gi,
    (_match, seconds: string) => {
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
    },
  );
}

/**
 * Split on paragraph boundaries, keeping each chunk under the character limit.
 * Splitting mid-sentence would put an audible seam in the middle of a line.
 */
function chunkScript(script: string, limit: number): string[] {
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

  // A single paragraph longer than the limit still has to go somewhere; send it
  // whole rather than cutting a sentence in half.
  return chunks.length > 0 ? chunks : [script];
}

async function synthesizeElevenLabs(script: string): Promise<SynthesisResult> {
  const apiKey = env.elevenLabsApiKey();
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured.");

  const voiceId = env.elevenLabsVoiceId();
  const chunks = chunkScript(normalizeBreaks(script), CHUNK_CHAR_LIMIT);
  const buffers: Buffer[] = [];

  for (const chunk of chunks) {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: chunk,
          // v2 multilingual honours break tags and handles long-form narration
          // better than the turbo models, which optimise for latency we do not
          // need in an overnight job.
          model_id: "eleven_multilingual_v2",
          voice_settings: ELEVENLABS_VOICE_SETTINGS,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `ElevenLabs synthesis failed (${response.status}): ${await response.text()}`,
      );
    }

    buffers.push(Buffer.from(await response.arrayBuffer()));
  }

  // Concatenating MP3 frames works because each chunk is a self-contained
  // stream of frames; players read them back to back as one file. Fine for
  // fixed-bitrate MP3 like ours — do not assume it for other codecs.
  return { audio: Buffer.concat(buffers), contentType: "audio/mpeg" };
}

async function synthesizeOpenAI(script: string): Promise<SynthesisResult> {
  const apiKey = env.openaiApiKey();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");

  // OpenAI TTS has no silence primitive, so break tags would be read as literal
  // text. Strip them and accept the flatter pacing.
  const plain = script.replace(/<break\s+time="[^"]*"\s*\/?>/gi, " ").trim();
  const chunks = chunkScript(plain, 3_800); // OpenAI caps input at 4096 chars
  const buffers: Buffer[] = [];

  for (const chunk of chunks) {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-tts",
        voice: "shimmer",
        input: chunk,
        response_format: "mp3",
        speed: 0.9,
        instructions:
          "Speak slowly and warmly, as a meditation guide. Leave generous space " +
          "between sentences. Never sound brisk or announcer-like.",
      }),
    });

    if (!response.ok) {
      throw new Error(
        `OpenAI TTS failed (${response.status}): ${await response.text()}`,
      );
    }

    buffers.push(Buffer.from(await response.arrayBuffer()));
  }

  return { audio: Buffer.concat(buffers), contentType: "audio/mpeg" };
}

/** Synthesize via the configured provider. Returns null when TTS is disabled. */
export async function synthesize(
  script: string,
): Promise<SynthesisResult | null> {
  switch (env.ttsProvider()) {
    case "elevenlabs":
      return synthesizeElevenLabs(script);
    case "openai":
      return synthesizeOpenAI(script);
    case "none":
      return null;
  }
}

/**
 * Synthesize and upload, returning a playable URL.
 *
 * Returns null when no TTS provider is configured — the caller marks the
 * meditation 'skipped' and the client falls back to Web Speech.
 */
export async function synthesizeAndStore(params: {
  userId: string;
  meditationId: string;
  script: string;
}): Promise<string | null> {
  const result = await synthesize(params.script);
  if (!result) return null;

  const supabase = createAdminClient();
  // Path is user-scoped so the storage policy can key off the first segment.
  const path = `${params.userId}/${params.meditationId}.mp3`;

  const { error } = await supabase.storage
    .from(AUDIO_BUCKET)
    .upload(path, result.audio, {
      contentType: result.contentType,
      upsert: true,
    });

  if (error) throw new Error(`Audio upload failed: ${error.message}`);

  return path;
}

/**
 * Signed playback URL for a stored object.
 *
 * The bucket is private: a meditation is written from someone's calendar and
 * their stated intention, and should not be guessable by URL. Signed links last
 * a day, which covers a session comfortably.
 */
export async function getPlaybackUrl(path: string): Promise<string | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(AUDIO_BUCKET)
    .createSignedUrl(path, 60 * 60 * 24);

  if (error) {
    console.error("[tts] failed to sign audio URL:", error.message);
    return null;
  }
  return data.signedUrl;
}
