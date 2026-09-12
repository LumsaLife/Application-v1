import { Logo } from "@/components/Logo";

/**
 * Shown instead of a protected page when the deployment is missing
 * configuration it cannot work without.
 *
 * Exists because the alternative is worse: a page that needs Supabase and
 * cannot reach it throws, and an unhandled server exception on Vercel reaches
 * the visitor as "Application error: a server-side exception has occurred ...
 * Digest: 3318172160" — which names nothing and leads nowhere. Naming the
 * missing variables turns a dead end into a two-minute fix.
 *
 * Safe to render publicly: it lists variable *names*, never values, and those
 * names are already in .env.example in the repo.
 */
export function SetupRequired({ missing }: { missing: string[] }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-lg space-y-6">
        <span className="text-gold">
          <Logo size={30} />
        </span>

        <div className="space-y-2.5">
          <h1 className="font-display text-[1.6rem] leading-snug text-text">
            Lumsa isn&rsquo;t finished setting up
          </h1>
          <p className="text-[15px] leading-relaxed text-muted">
            This deployment is missing configuration it needs to run. Nothing is
            broken in the app itself — these values just haven&rsquo;t been set
            yet.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-5">
          <p className="text-[13px] font-medium text-text">
            Missing environment {missing.length === 1 ? "variable" : "variables"}
          </p>
          <ul className="mt-2.5 space-y-1">
            {missing.map((name) => (
              <li key={name} className="font-mono text-[12px] text-danger">
                {name}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-[13px] leading-relaxed text-muted">
            Set these in your hosting environment, then{" "}
            <strong className="font-medium text-text">redeploy</strong>. The
            <code className="mx-1 font-mono text-[12px]">NEXT_PUBLIC_</code>
            ones are compiled into the build, so setting them does nothing to a
            deployment that already exists.
          </p>
        </div>

        <p className="text-[13px] leading-relaxed text-faint">
          <code className="font-mono">.env.example</code> in the repo documents
          each one, and{" "}
          <code className="font-mono">/api/auth/demo-status</code> reports what
          this build actually resolved.
        </p>
      </div>
    </main>
  );
}
