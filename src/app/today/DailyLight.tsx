"use client";

import { useState } from "react";
import type { UserChallengeStatus } from "@/lib/challenges/types";
import { markLightDone, passOnLight } from "./actions";

/**
 * Today's Light — the small outward act that sits below the meditation.
 *
 * Restraint is the whole design brief here. No confetti, no sound, no score, no
 * streak. It is an invitation, and an invitation that congratulates you for
 * accepting it stops being one. The section sits visually quieter than the
 * meditation above it and never competes for the eye.
 *
 * Nothing in this component can imply failure. Passing on a day costs nothing
 * and is never described as a break, a miss, or a loss.
 */

interface LightState {
  title: string;
  invitation: string;
  status: UserChallengeStatus;
  canSwap: boolean;
}

export function DailyLight({ initial }: { initial: LightState }) {
  const [light, setLight] = useState<LightState>(initial);
  const [pending, setPending] = useState<"done" | "pass" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDone() {
    setPending("done");
    setError(null);

    const result = await markLightDone();
    setPending(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setLight((current) => ({ ...current, status: "completed" }));
  }

  async function handlePass() {
    setPending("pass");
    setError(null);

    const result = await passOnLight();
    setPending(null);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setLight(result.light);
  }

  return (
    <section className="space-y-4" aria-labelledby="daily-light-heading">
      <div className="space-y-3">
        {/* The gold rule is the only ornament. It separates without a heading
            weight that would compete with the meditation above. */}
        <div className="h-px w-10 bg-gold opacity-60" aria-hidden="true" />
        <h2
          id="daily-light-heading"
          className="font-display text-[13px] uppercase tracking-[0.16em] text-gold"
        >
          Today&rsquo;s Light
        </h2>
      </div>

      {light.status === "completed" ? (
        <Acknowledgement title={light.title} />
      ) : light.status === "skipped" ? (
        <Resting />
      ) : (
        <div className="animate-fade-up space-y-4">
          <div className="space-y-1.5">
            <p className="font-display text-[1.15rem] leading-snug text-text">
              {light.title}
            </p>
            <p className="text-[15px] leading-relaxed text-muted">
              {light.invitation}
            </p>
          </div>

          {error && (
            <p role="alert" className="text-[13px] text-danger">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={handleDone}
              disabled={pending !== null}
              className="rounded-full border border-border px-4 py-1.5 text-[13px] font-medium text-text transition-colors hover:border-gold hover:text-gold disabled:opacity-45"
            >
              {pending === "done" ? "…" : "Done"}
            </button>
            <button
              onClick={handlePass}
              disabled={pending !== null}
              className="rounded-full px-4 py-1.5 text-[13px] text-muted transition-colors hover:text-text disabled:opacity-45"
            >
              {pending === "pass" ? "…" : "Not today"}
            </button>
          </div>

          {/* Said once, plainly, so the second "Not today" isn't a surprise —
              and so nobody sits there hunting for a better one. */}
          {!light.canSwap && (
            <p className="text-[13px] text-faint">
              This is the other one. Whatever you choose, the day is fine.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * The whole reward. One line, no ornament — the acknowledgement has to be
 * quieter than the act, or it turns the act into a transaction.
 */
function Acknowledgement({ title }: { title: string }) {
  return (
    <div className="animate-fade-up space-y-1.5">
      <p className="font-display text-[1.15rem] leading-snug text-gold">
        {title}
      </p>
      <p className="text-[15px] leading-relaxed text-muted">
        Noted. That&rsquo;s the whole practice.
      </p>
    </div>
  );
}

/** After the day's one alternative is also passed on. Never a reprimand. */
function Resting() {
  return (
    <p className="animate-fade-up text-[15px] leading-relaxed text-muted">
      Resting today. There&rsquo;ll be another one tomorrow.
    </p>
  );
}
