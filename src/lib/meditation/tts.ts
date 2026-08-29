/**
 * Text-to-speech.
 *
 * ElevenLabs is the provider these settings are tuned for. It honours
 * `<break time="Ns" />` tags, which is the whole reason the prompt emits them:
 * silence is not decoration in a meditation, it is the practice, and a provider
 * that ignores break tags produces a script read aloud rather than a session.
 *
 * OpenAI TTS is kept as a cheaper alternative, but it has no silence primitive,
 * so break tags are stripped and the pacing flattens. Treat it as a budget
 * fallback, not an equivalent.
 *
 * With neither key configured, generation stores the script with
 * audio_status='skipped' and the client falls back to the browser's Web Speech
 * API — fine for local development, not for anyone you want to impress.
 */

import "server-only";

import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  chunkScript,
  durationFromBytes,
  normalizeBreaks,
  stripBreaks,
} from "./script-chunking";

export const AUDIO_BUCKET = "meditations";

/**
 * Characters per request. ElevenLabs accepts more, but shorter requests fail
 * less often and let a retry re-send one chunk rather than a 15-minute script.
 */
const CHUNK_CHAR_LIMIT = 2_400;

const MAX_ATTEMPTS_PER_CHUNK = 3;

export interface SynthesisResult {
  audio: Buffer;
  contentType: string;
  /** Derived from the byte count. Accurate because the output is CBR. */
  durationSeconds: number;
  /** Billable characters sent to the provider. Logged for cost tracking. */
  characterCount: number;
}

/** Voice settings tuned for slow, warm, unhurried narration. */
const ELEVENLABS_VOICE_SETTINGS = {
  // High stability keeps delivery even. Meditation wants consistency;
  // expressive variation reads as performance and pulls attention outward.
  stability: 0.62,
  similarity_boost: 0.75,
  // Low style exaggeration — plain, not theatrical.
  style: 0.12,
  use_speaker_boost: true,
  // Slightly below natural pace. The single most effective setting here.
  speed: 0.88,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST with retry on the failures that are worth retrying.
 *
 * ElevenLabs rate-limits on *concurrent* requests, not just requests per
 * minute, so a 429 here means "someone else is mid-synthesis" — which is
 * transient and very much worth waiting out. 4xx other than 429 means the
 * request itself is wrong (bad voice ID, quota exhausted) and retrying only
 * burns time.
 */
async function postWithRetry(
  url: string,
  init: RequestInit,
  label: string,
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_CHUNK; attempt++) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return response;

      const retryable = response.status === 429 || response.status >= 500;
      const body = await response.text();

      if (!retryable || attempt === MAX_ATTEMPTS_PER_CHUNK) {
        throw new Error(`${label} failed (${response.status}): ${body}`);
      }

      // Honour Retry-After when the provider sends one; otherwise back off
      // exponentially from 2s.
      const retryAfter = Number(response.headers.get("retry-after"));
      const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 2000 * 2 ** (attempt - 1);

      console.warn(
        `[tts] ${label} ${response.status}, retrying in ${delayMs}ms ` +
          `(attempt ${attempt}/${MAX_ATTEMPTS_PER_CHUNK})`,
      );
      await sleep(delayMs);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      // A thrown non-retryable error from above should propagate immediately.
      if (lastError.message.includes("failed (")) throw lastError;
      if (attempt === MAX_ATTEMPTS_PER_CHUNK) throw lastError;
      await sleep(2000 * 2 ** (attempt - 1));
    }
  }

  throw lastError ?? new Error(`${label} failed after retries`);
}

async function synthesizeElevenLabs(script: string): Promise<SynthesisResult> {
  const apiKey = env.elevenLabsApiKey();
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured.");

  const voiceId = env.elevenLabsVoiceId();
  const chunks = chunkScript(normalizeBreaks(script), CHUNK_CHAR_LIMIT);
  const buffers: Buffer[] = [];
  let characterCount = 0;

  // Sequential on purpose. ElevenLabs limits concurrent requests per account,
  // and the chunks have to be concatenated in order anyway.
  for (const [index, chunk] of chunks.entries()) {
    const response = await postWithRetry(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: chunk,
          // v2 multilingual honours break tags and handles long-form narration
          // better than the turbo models, which optimise for a latency we do
          // not need in a background job.
          model_id: "eleven_multilingual_v2",
          voice_settings: ELEVENLABS_VOICE_SETTINGS,
          // Gives the model the surrounding text so prosody carries across a
          // chunk boundary instead of resetting mid-thought.
          previous_text: index > 0 ? chunks[index - 1].slice(-500) : undefined,
          next_text:
            index < chunks.length - 1
              ? chunks[index + 1].slice(0, 500)
              : undefined,
        }),
      },
      `ElevenLabs chunk ${index + 1}/${chunks.length}`,
    );

    buffers.push(Buffer.from(await response.arrayBuffer()));
    characterCount += chunk.length;
  }

  // Concatenating MP3 frames works because each chunk is a self-contained
  // stream of frames; players read them back to back as one file. Valid for
  // fixed-bitrate MP3 like ours — do not assume it for other codecs.
  const audio = Buffer.concat(buffers);

  return {
    audio,
    contentType: "audio/mpeg",
    durationSeconds: durationFromBytes(audio.length),
    characterCount,
  };
}

async function synthesizeOpenAI(script: string): Promise<SynthesisResult> {
  const apiKey = env.openaiApiKey();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");

  // OpenAI TTS has no silence primitive, so break tags would be read as literal
  // text. Strip them and accept the flatter pacing.
  const plain = stripBreaks(script);
  const chunks = chunkScript(plain, 3_800); // OpenAI caps input at 4096 chars
  const buffers: Buffer[] = [];
  let characterCount = 0;

  for (const [index, chunk] of chunks.entries()) {
    const response = await postWithRetry(
      "https://api.openai.com/v1/audio/speech",
      {
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
            "Speak slowly and warmly, as a meditation guide. Leave generous " +
            "space between sentences. Never sound brisk or announcer-like.",
        }),
      },
      `OpenAI TTS chunk ${index + 1}/${chunks.length}`,
    );

    buffers.push(Buffer.from(await response.arrayBuffer()));
    characterCount += chunk.length;
  }

  const audio = Buffer.concat(buffers);

  return {
    audio,
    contentType: "audio/mpeg",
    durationSeconds: durationFromBytes(audio.length),
    characterCount,
  };
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

export interface StoredAudio {
  path: string;
  durationSeconds: number;
  characterCount: number;
}

/**
 * Synthesize and upload.
 *
 * Returns null when no TTS provider is configured — the caller marks the
 * meditation 'skipped' and the client falls back to Web Speech.
 */
export async function synthesizeAndStore(params: {
  userId: string;
  meditationId: string;
  script: string;
}): Promise<StoredAudio | null> {
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

  console.log(
    `[tts] synthesized ${params.meditationId}: ${result.characterCount} chars, ` +
      `${result.durationSeconds}s, ${(result.audio.length / 1024 / 1024).toFixed(1)}MB`,
  );

  return {
    path,
    durationSeconds: result.durationSeconds,
    characterCount: result.characterCount,
  };
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
