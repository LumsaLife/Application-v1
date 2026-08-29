"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, Notice } from "@/components/ui";
import { Wordmark } from "@/components/Logo";

/**
 * Magic-link sign in.
 *
 * No password, no social login. One field is the least friction we can offer,
 * and it means there is no password to store, reset, or leak. If you later add
 * Google sign-in, note that it still will not grant calendar access — that is a
 * separate consent screen by design (see src/lib/calendar/google.ts).
 */
function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/today";

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("sending");
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    if (signInError) {
      setError(signInError.message);
      setStatus("idle");
      return;
    }
    setStatus("sent");
  }

  if (status === "sent") {
    return (
      <div className="animate-fade-up space-y-4 text-center">
        <h1 className="font-display text-2xl text-text">Check your email</h1>
        <p className="text-[15px] leading-relaxed text-muted">
          We sent a link to <span className="text-text">{email}</span>. Open it
          on this device and you&rsquo;ll be signed in.
        </p>
        <button
          onClick={() => setStatus("idle")}
          className="text-sm text-gold underline underline-offset-4 hover:text-gold-bright"
        >
          Use a different address
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="animate-fade-up space-y-5">
      <div className="space-y-2 text-center">
        <h1 className="font-display text-2xl text-text">Welcome</h1>
        <p className="text-[15px] leading-relaxed text-muted">
          Enter your email and we&rsquo;ll send you a sign-in link. No password
          to remember.
        </p>
      </div>

      <Input
        type="email"
        required
        autoFocus
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        aria-label="Email address"
      />

      {error && <Notice>{error}</Notice>}

      <Button
        type="submit"
        className="w-full"
        loading={status === "sending"}
        disabled={!email.trim()}
      >
        Send me a link
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm space-y-10">
        <div className="flex justify-center">
          <Wordmark size={30} />
        </div>
        <Suspense
          fallback={<div className="h-64" aria-busy="true" aria-live="polite" />}
        >
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
