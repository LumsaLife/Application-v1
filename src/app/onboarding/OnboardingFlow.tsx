"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import {
  Button,
  Input,
  Notice,
  OptionCard,
  Textarea,
} from "@/components/ui";
import {
  LENGTH_OPTIONS,
  TONE_OPTIONS,
  TRADITION_DISCLAIMER,
} from "@/lib/tone-options";
import type { MeditationLength, TonePreference } from "@/lib/types";
import { completeOnboarding } from "./actions";

/**
 * Onboarding, one question per screen.
 *
 * One-at-a-time rather than a single long form: these are reflective questions,
 * and a wall of inputs invites people to fill them in carelessly. The mantra and
 * the life quest are the two things every future meditation is built from, so
 * it is worth the extra taps to have them answered thoughtfully.
 */

type Step = "name" | "mantra" | "quest" | "tone" | "length";

const STEPS: Step[] = ["name", "mantra", "quest", "tone", "length"];

export function OnboardingFlow({ initialName }: { initialName: string }) {
  const router = useRouter();

  const [stepIndex, setStepIndex] = useState(0);
  const [displayName, setDisplayName] = useState(initialName);
  const [mantra, setMantra] = useState("");
  const [lifeQuest, setLifeQuest] = useState("");
  const [tone, setTone] = useState<TonePreference>("secular");
  const [length, setLength] = useState<MeditationLength>(10);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step = STEPS[stepIndex];
  const isLast = stepIndex === STEPS.length - 1;

  const canAdvance = {
    name: displayName.trim().length > 0,
    mantra: mantra.trim().length > 0,
    quest: lifeQuest.trim().length > 0,
    tone: true,
    length: true,
  }[step];

  async function handleNext() {
    if (!isLast) {
      setStepIndex((i) => i + 1);
      return;
    }

    setSaving(true);
    setError(null);

    const result = await completeOnboarding({
      displayName,
      mantra,
      lifeQuest,
      tone,
      length,
      // Read from the browser — the only place the user's timezone is knowable
      // without asking them outright.
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });

    if (!result.ok) {
      setError(result.error);
      setSaving(false);
      return;
    }

    // Straight to calendar connection — the meditation is noticeably better
    // with it, and this is the moment the value is most obvious.
    router.push("/onboarding/calendar");
  }

  return (
    <main className="flex min-h-dvh flex-col px-6 py-10">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <div className="flex items-center justify-between">
          <span className="text-gold">
            <Logo size={26} />
          </span>
          <span className="text-[13px] tabular-nums text-faint">
            {stepIndex + 1} of {STEPS.length}
          </span>
        </div>

        {/* Progress: a thin gold thread rather than a chunky bar. */}
        <div
          className="mt-5 h-px w-full bg-border"
          role="progressbar"
          aria-valuenow={stepIndex + 1}
          aria-valuemin={1}
          aria-valuemax={STEPS.length}
          aria-label="Onboarding progress"
        >
          <div
            className="h-px bg-gold transition-all duration-500 ease-out"
            style={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%` }}
          />
        </div>

        <div key={step} className="animate-fade-up flex-1 space-y-7 pt-12">
          {step === "name" && (
            <>
              <Header
                title="What should we call you?"
                subtitle="Lumsa will use this occasionally, at the start of a practice."
              />
              <Input
                autoFocus
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                maxLength={80}
                aria-label="Your name"
              />
            </>
          )}

          {step === "mantra" && (
            <>
              <Header
                title="Is there a phrase you want to live with?"
                subtitle="A few words you'd like returned to you — chosen or borrowed, it doesn't matter. It'll be woven into each practice."
              />
              <Textarea
                autoFocus
                rows={3}
                value={mantra}
                onChange={(e) => setMantra(e.target.value)}
                placeholder="Begin again."
                maxLength={400}
                aria-label="Your mantra"
              />
              <Examples
                items={[
                  "Begin again.",
                  "I am allowed to take up space.",
                  "This too is the path.",
                ]}
                onPick={setMantra}
              />
            </>
          )}

          {step === "quest" && (
            <>
              <Header
                title="What are you working toward?"
                subtitle="Whatever's actually on your mind — a project, a relationship, a way you want to be. Plain words are better than lofty ones."
              />
              <Textarea
                autoFocus
                rows={4}
                value={lifeQuest}
                onChange={(e) => setLifeQuest(e.target.value)}
                placeholder="Be more patient with my team."
                maxLength={600}
                aria-label="Your life quest"
              />
              <Examples
                items={[
                  "Be more patient with my team.",
                  "Finish my dissertation.",
                  "Stop bracing for bad news.",
                ]}
                onPick={setLifeQuest}
              />
            </>
          )}

          {step === "tone" && (
            <>
              <Header
                title="How should it sound?"
                subtitle="This shapes the language and imagery of your practice."
              />
              <div className="space-y-2">
                {TONE_OPTIONS.map((option) => (
                  <OptionCard
                    key={option.value}
                    selected={tone === option.value}
                    onClick={() => setTone(option.value)}
                    title={option.title}
                    description={option.description}
                  />
                ))}
              </div>
              <p className="text-[13px] leading-relaxed text-faint">
                {TRADITION_DISCLAIMER}
              </p>
            </>
          )}

          {step === "length" && (
            <>
              <Header
                title="How long do you want to sit?"
                subtitle="You can change this any day. Shorter and done beats longer and skipped."
              />
              <div className="space-y-2">
                {LENGTH_OPTIONS.map((option) => (
                  <OptionCard
                    key={option.value}
                    selected={length === option.value}
                    onClick={() => setLength(option.value)}
                    title={option.title}
                    description={option.description}
                  />
                ))}
              </div>
            </>
          )}

          {error && <Notice>{error}</Notice>}
        </div>

        <div className="flex items-center justify-between gap-3 pt-8">
          {stepIndex > 0 ? (
            <Button
              variant="ghost"
              onClick={() => setStepIndex((i) => i - 1)}
              disabled={saving}
            >
              Back
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={handleNext} disabled={!canAdvance} loading={saving}>
            {isLast ? "Continue" : "Next"}
          </Button>
        </div>
      </div>
    </main>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="space-y-2.5">
      <h1 className="font-display text-[1.6rem] leading-snug text-text">
        {title}
      </h1>
      <p className="text-[15px] leading-relaxed text-muted">{subtitle}</p>
    </div>
  );
}

/**
 * Tappable examples. A blank box asking for your mantra is intimidating; three
 * concrete options show the register without prescribing an answer.
 */
function Examples({
  items,
  onPick,
}: {
  items: string[];
  onPick: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[13px] text-faint">Or start from one of these:</p>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onPick(item)}
            className="rounded-full border border-border px-3 py-1.5 text-[13px] text-muted transition-colors hover:border-gold hover:text-gold"
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}
