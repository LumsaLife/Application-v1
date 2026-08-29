import Link from "next/link";
import { Logo, Wordmark } from "@/components/Logo";

/**
 * Landing page. Public — the middleware lets "/" through.
 *
 * Says what Lumsa actually does in the first two sentences rather than leading
 * with atmosphere. The calm is in the type and the spacing; it does not need to
 * be in the copy as well.
 */
export default function LandingPage() {
  return (
    <main className="flex min-h-dvh flex-col">
      <header className="px-6 py-6 sm:px-10">
        <Wordmark size={26} />
      </header>

      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-24 text-center">
        <div className="animate-fade-up w-full max-w-xl space-y-8">
          <div
            className="animate-breathe mx-auto text-gold"
            aria-hidden="true"
          >
            <Logo size={76} />
          </div>

          <div className="space-y-5">
            <h1 className="font-display text-[2.1rem] leading-[1.15] text-text sm:text-5xl">
              Illuminating your journey
            </h1>
            <p className="mx-auto max-w-md text-[17px] leading-relaxed text-muted">
              Most meditation apps hand you the same session as everyone else.
              Lumsa writes today&rsquo;s practice from your mantra, what
              you&rsquo;re working toward, and the actual shape of your day.
            </p>
          </div>

          <div className="flex flex-col items-center gap-4 pt-2">
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-full bg-gold px-7 py-3 text-sm font-medium text-canvas transition-all duration-200 hover:bg-gold-bright active:scale-[0.985]"
            >
              Begin
            </Link>
            <p className="text-[13px] text-faint">
              Free while in early access · No card required
            </p>
          </div>
        </div>
      </div>

      <footer className="border-t border-border px-6 py-6 text-center sm:px-10">
        <p className="mx-auto max-w-lg text-[13px] leading-relaxed text-faint">
          Lumsa welcomes every faith and none. The tradition you choose shapes
          the language and imagery of your practice — it never speaks for that
          tradition or makes claims on its behalf.
        </p>
      </footer>
    </main>
  );
}
