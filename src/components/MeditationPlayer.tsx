"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The player.
 *
 * Two modes, and the fallback is not a toy:
 *   - `audio`: a real MP3 from the TTS provider. Seekable, with a progress bar.
 *   - `speech`: the browser's Web Speech API, used when no TTS key is set. It
 *     cannot seek and cannot report position, so we show elapsed time against
 *     an estimate rather than faking a progress bar we can't honour.
 *
 * onComplete fires once per mount, when the practice actually finishes — it is
 * what marks the day done and opens the journal prompt.
 */

type Mode = "audio" | "speech";

export function MeditationPlayer({
  audioUrl,
  script,
  estimatedSeconds,
  onComplete,
}: {
  audioUrl: string | null;
  /** Display script — break tags already stripped. */
  script: string;
  estimatedSeconds: number;
  onComplete: () => void;
}) {
  const mode: Mode = audioUrl ? "audio" : "speech";

  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(estimatedSeconds);
  const [speechSupported, setSpeechSupported] = useState(true);

  // Guard so a scrub back past the end can't fire completion twice.
  const completedRef = useRef(false);

  const handleComplete = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    onComplete();
  }, [onComplete]);

  useEffect(() => {
    if (mode === "speech" && typeof window !== "undefined") {
      setSpeechSupported("speechSynthesis" in window);
    }
  }, [mode]);

  // Stop any in-flight speech when the component goes away — otherwise it keeps
  // talking after navigation, which is genuinely startling.
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // ---- Web Speech elapsed timer -------------------------------------------
  useEffect(() => {
    if (mode !== "speech" || !playing) return;
    const id = setInterval(() => setPosition((p) => p + 1), 1000);
    return () => clearInterval(id);
  }, [mode, playing]);

  function toggleAudio() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      void audio.play();
    }
  }

  function toggleSpeech() {
    if (!("speechSynthesis" in window)) return;

    if (playing) {
      window.speechSynthesis.pause();
      setPlaying(false);
      return;
    }

    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      setPlaying(true);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(script);
    utterance.rate = 0.78; // as slow as most voices stay natural
    utterance.pitch = 0.95;
    utterance.onend = () => {
      setPlaying(false);
      handleComplete();
    };
    utterance.onerror = () => setPlaying(false);

    window.speechSynthesis.speak(utterance);
    setPlaying(true);
  }

  const progress = duration > 0 ? Math.min(position / duration, 1) : 0;

  return (
    <div className="space-y-5">
      {mode === "audio" && (
        <audio
          ref={audioRef}
          src={audioUrl!}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            // Some encoders report Infinity until the file is fully buffered.
            const d = e.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) setDuration(d);
          }}
          onEnded={() => {
            setPlaying(false);
            handleComplete();
          }}
        />
      )}

      <div className="flex items-center gap-4">
        <button
          onClick={mode === "audio" ? toggleAudio : toggleSpeech}
          disabled={mode === "speech" && !speechSupported}
          aria-label={playing ? "Pause" : "Play"}
          className="group relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-gold text-canvas transition-all duration-200 hover:bg-gold-bright active:scale-95 disabled:opacity-40"
        >
          {/* A soft halo that breathes only while playing. */}
          {playing && (
            <span
              className="animate-breathe absolute inset-0 rounded-full bg-gold opacity-30"
              aria-hidden="true"
            />
          )}
          <span className="relative">
            {playing ? <PauseIcon /> : <PlayIcon />}
          </span>
        </button>

        <div className="min-w-0 flex-1 space-y-2">
          {mode === "audio" ? (
            <input
              type="range"
              min={0}
              max={duration || 1}
              step={1}
              value={position}
              onChange={(e) => {
                const next = Number(e.target.value);
                setPosition(next);
                if (audioRef.current) audioRef.current.currentTime = next;
              }}
              aria-label="Seek"
              className="h-1 w-full cursor-pointer appearance-none rounded-full bg-border accent-[var(--gold)]"
              style={{
                background: `linear-gradient(to right, var(--gold) ${progress * 100}%, var(--border) ${progress * 100}%)`,
              }}
            />
          ) : (
            <div
              className="h-1 w-full overflow-hidden rounded-full bg-border"
              role="progressbar"
              aria-valuenow={Math.round(progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full bg-gold transition-[width] duration-1000 ease-linear"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          )}

          <div className="flex items-center justify-between text-[12px] tabular-nums text-faint">
            <span>{formatTime(position)}</span>
            <span>
              {mode === "speech" && "≈ "}
              {formatTime(duration)}
            </span>
          </div>
        </div>
      </div>

      {mode === "speech" && (
        <p className="text-[13px] leading-relaxed text-faint">
          {speechSupported
            ? "Playing with your browser's built-in voice — no narration provider is configured for this deployment."
            : "Your browser can't speak this aloud. The full script is below."}
        </p>
      )}
    </div>
  );
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function PlayIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {/* Nudged right so it reads as optically centred in the circle. */}
      <path d="M8.5 5.6c0-.8.9-1.3 1.6-.9l8.2 5.5c.6.4.6 1.3 0 1.7l-8.2 5.5c-.7.4-1.6-.1-1.6-.9V5.6z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="7" y="5" width="3.5" height="14" rx="1.4" />
      <rect x="13.5" y="5" width="3.5" height="14" rx="1.4" />
    </svg>
  );
}
