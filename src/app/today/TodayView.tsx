"use client";

import { useState } from "react";
import { MeditationPlayer } from "@/components/MeditationPlayer";
import { Button, Notice, Textarea } from "@/components/ui";
import type { Mood } from "@/lib/types";
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

export function TodayView({
  meditationId,
  audioUrl,
  displayScript,
  estimatedSeconds,
  alreadyCompleted,
  alreadyJournaled,
}: {
  meditationId: string;
  audioUrl: string | null;
  displayScript: string;
  estimatedSeconds: number;
  alreadyCompleted: boolean;
  alreadyJournaled: boolean;
}) {
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
      <MeditationPlayer
        audioUrl={audioUrl}
        script={displayScript}
        estimatedSeconds={estimatedSeconds}
        onComplete={handleComplete}
      />

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
