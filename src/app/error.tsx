"use client";

/**
 * Catch-all for unhandled errors in the app.
 *
 * Without this, Vercel shows "Application error: a server-side exception has
 * occurred ... Digest: 3318172160" — a message that names nothing, leads
 * nowhere, and looks alarming to anyone who is not the developer. This gives
 * back something honest to look at, and a route to the diagnostic.
 *
 * Deliberately does not render the error message: on the server those can carry
 * connection strings and internal paths. The digest is enough to find the real
 * stack trace in the hosting logs.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-md space-y-5 text-center">
        <h1 className="font-display text-[1.5rem] leading-snug text-text">
          Something went wrong here
        </h1>
        <p className="text-[15px] leading-relaxed text-muted">
          Not your fault, and nothing you did. Trying again often clears it.
        </p>

        <div className="flex items-center justify-center gap-2 pt-1">
          <button
            onClick={reset}
            className="rounded-full bg-gold px-5 py-2.5 text-sm font-medium text-canvas transition-all hover:bg-gold-bright active:scale-[0.985]"
          >
            Try again
          </button>
          {/*
            A plain anchor, not next/link, on purpose. This boundary renders
            because something already threw, so the React tree and the client
            router may be in a bad state — a full page load is the reliable way
            out, where a client-side navigation could fail the same way again.
          */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            className="rounded-full px-5 py-2.5 text-sm text-muted transition-colors hover:text-text"
          >
            Back to start
          </a>
        </div>

        {error.digest && (
          <p className="pt-2 font-mono text-[12px] text-faint">
            Reference: {error.digest}
          </p>
        )}
      </div>
    </main>
  );
}
