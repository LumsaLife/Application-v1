import { env } from "@/lib/env";

/**
 * Shown on every page while demo mode is on.
 *
 * Demo mode disables sign-in, so this needs to be impossible to miss — a
 * deployment where anyone with the link is already inside should never be
 * mistaken for the real thing. Rendered from the root layout so there is one
 * place it can be switched on and no page can forget it.
 */
export function DemoBanner() {
  if (!env.demoMode()) return null;

  return (
    <div className="border-b border-gold/30 bg-gold-soft px-6 py-2.5">
      <p className="mx-auto flex max-w-2xl flex-wrap items-center gap-x-2 gap-y-1 text-[12px] leading-relaxed text-muted">
        <span className="font-medium text-gold">Demo mode</span>
        <span aria-hidden="true">·</span>
        <span>
          Sign-in is off and anyone with this link can use the app. Your data is
          still private to this browser session.
        </span>
        <a
          href="/api/auth/demo?restart=1"
          className="text-gold underline underline-offset-2 hover:text-gold-bright"
        >
          Restart onboarding
        </a>
      </p>
    </div>
  );
}
