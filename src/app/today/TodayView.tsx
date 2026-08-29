"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MeditationPlayer } from "@/components/MeditationPlayer";
import { Button, Notice, Textarea } from "@/components/ui";
import type { AudioStatus, Mood } from "@/lib/types";
import { completeSession, saveReflection } from "./actions";

/**
 * The interactive half of the Today screen: play, then reflect.
 *
 * The journal prompt only appears once the practice is finished. Showing it
 * up-front would turn a meditation into a task with a form at the end.
 */

const MOODS: { value: Mood; label: string }[] = [
  { value: "heavy", label: "Heavy" },
  { value: "tender", label: "Tender" },
  { value: "steady", label: "Steady" },
  { value: "light", label: "Light" },
  { value: "radiant", label: "Radiant" },
];

/** How often to re-check while another worker is synthesizing. */
const POLL_INTERVAL_MS = 4000;

export function TodayView({
  meditationId,
  initialAudioUrl,
  initialAudioStatus,
  displayScript,
  estimatedSeconds,
  alreadyCompleted,
  alreadyJournaled,
}: {
  meditationId: string;
  initialAudioUrl: string | null;
  initialAudioStatus: AudioStatus;
  displayScript: string;
  estimatedSeconds: number;
  alreadyCompleted: boolean;
  alreadyJournaled: boolean;
}) {
  const audio = useAudioReadiness({
    meditationId,
    initialUrl: initialAudioUrl,
    initialStatus: initialAudioStatus,
  });

  const [finished, setFinished] = useState(alreadyCompleted);
  const [showScript, setShowScript] = useState(false);

  const [mood, setMood] = useState<Mood | null>(null);
  const [reflection, setReflection] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(alreadyJournaled);
  const [error, setError] = useState<string | null>(null);

  async function handleComplete() {
    setFinished(true);
    await completeSession(meditationId);
  }

  async function handleSaveReflection() {
    setSaving(true);
    setError(null);

    const result = await saveReflection({
      meditationId,
      mood,
      reflectionText: reflection,
    });

    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSaved(true);
  }

  return (
    <div className="space-y-8">
      {audio.preparing ? (
        <PreparingNarration />
      ) : (
        <MeditationPlayer
          audioUrl={audio.url}
          script={displayScript}
          estimatedSeconds={audio.durationSeconds ?? estimatedSeconds}
          onComplete={handleComplete}
        />
      )}

      {audio.status === "failed" && (
        <p className="text-[13px] leading-relaxed text-muted">
          Narration didn&rsquo;t come through for today&rsquo;s practice. You can
          read it below, or press play to have your browser speak it.
        </p>
      )}

      <div>
        <button
          onClick={() => setShowScript((s) => !s)}
          aria-expanded={showScript}
          className="text-[13px] text-muted underline underline-offset-4 transition-colors hover:text-text"
        >
          {showScript ? "Hide the words" : "Read the words instead"}
        </button>

        {showScript && (
          <div className="animate-fade-up mt-4 space-y-4 border-l-2 border-gold-soft pl-5">
            {displayScript.split(/\n{2,}/).map((paragraph, i) => (
              <p
                key={i}
                className="text-[15px] leading-[1.85] text-muted"
              >
                {paragraph}
              </p>
            ))}
          </div>
        )}
      </div>

      {finished && !saved && (
        <div className="animate-fade-up space-y-4 rounded-2xl border border-border bg-surface p-5">
          <div className="space-y-1.5">
            <h2 className="font-display text-lg text-text">How do you feel?</h2>
            <p className="text-[13px] text-muted">
              Optional, and there&rsquo;s no right answer. A single word is plenty.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {MOODS.map((option) => (
              <button
                key={option.value}
                onClick={() =>
                  setMood((m) => (m === option.value ? null : option.value))
                }
                aria-pressed={mood === option.value}
                className={
                  mood === option.value
                    ? "rounded-full border border-gold bg-gold-soft px-3.5 py-1.5 text-[13px] font-medium text-gold"
                    : "rounded-full border border-border px-3.5 py-1.5 text-[13px] text-muted transition-colors hover:border-border-strong hover:text-text"
                }
              >
                {option.label}
              </button>
            ))}
          </div>

          <Textarea
            rows={3}
            value={reflection}
            onChange={(e) => setReflection(e.target.value)}
            placeholder="Anything you want to remember about this one…"
            maxLength={2000}
            aria-label="Your reflection"
          />

          {error && <Notice>{error}</Notice>}

          <div className="flex items-center gap-2">
            <Button
              onClick={handleSaveReflection}
              loading={saving}
              disabled={!mood && !reflection.trim()}
            >
              Save
            </Button>
            <Button variant="ghost" onClick={() => setSaved(true)}>
              Skip
            </Button>
          </div>
        </div>
      )}

      {finished && saved && (
        <p className="animate-fade-up text-center text-[14px] text-muted">
          That&rsquo;s today. See you tomorrow.
        </p>
      )}
    </div>
  );
}

/**
 * Drives audio from 'pending' to playable.
 *
 * Two paths converge here. Usually the overnight cron has already synthesized
 * and this hook does nothing. When it hasn't — a user who signed up this
 * morning, or a cron run that fell short of its budget — we ask the server to
 * synthesize now rather than leaving them to wait for the ten-minute worker.
 *
 * If another worker already holds the claim, the POST returns without doing the
 * work and we fall back to polling until it lands.
 */
function useAudioReadiness({
  meditationId,
  initialUrl,
  initialStatus,
}: {
  meditationId: string;
  initialUrl: string | null;
  initialStatus: AudioStatus;
}) {
  const [status, setStatus] = useState<AudioStatus>(initialStatus);
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);

  // Guards against React 18 strict-mode double-invoking the effect and paying
  // ElevenLabs twice — the server-side claim would catch it, but not making the
  // second request at all is better.
  const requestedRef = useRef(false);

  const apply = useCallback(
    (payload: {
      status: AudioStatus;
      url: string | null;
      durationSeconds: number | null;
    }) => {
      setStatus(payload.status);
      if (payload.url) setUrl(payload.url);
      if (payload.durationSeconds) setDurationSeconds(payload.durationSeconds);
    },
    [],
  );

  useEffect(() => {
    if (status !== "pending" && status !== "synthesizing") return;

    let cancelled = false;

    async function kickOff() {
      if (requestedRef.current) return;
      requestedRef.current = true;

      try {
        const response = await fetch("/api/meditation/audio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ meditationId }),
        });
        if (!cancelled && response.ok) apply(await response.json());
      } catch {
        // Network hiccup — the poll below will pick things up.
      }
    }

    async function poll() {
      try {
        const response = await fetch(
          `/api/meditation/audio?id=${encodeURIComponent(meditationId)}`,
        );
        if (!cancelled && response.ok) apply(await response.json());
      } catch {
        // Ignore; we'll try again on the next tick.
      }
    }

    void kickOff();
    const timer = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [status, meditationId, apply]);

  return {
    status,
    url,
    durationSeconds,
    /**
     * 'skipped' means no TTS provider is configured, which is not a waiting
     * state — the player falls straight through to Web Speech.
     */
    preparing: status === "pending" || status === "synthesizing",
  };
}

/** Placeholder shown while narration is being made. */
function PreparingNarration() {
  return (
    <div className="flex items-center gap-4" aria-live="polite">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-border bg-surface">
        <span className="animate-breathe block h-5 w-5 rounded-full bg-gold opacity-70" />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-[15px] text-text">Preparing your narration…</p>
        <p className="text-[13px] leading-relaxed text-muted">
          This takes up to a minute. You can read the words below in the
          meantime.
        </p>
      </div>
    </div>
  );
}
