"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import type { CalendarConnectionSummary, CalendarProvider } from "@/lib/types";

/**
 * Calendar connection management, shared by onboarding and settings.
 *
 * The disclosure block is not boilerplate. Asking to read someone's calendar is
 * the single biggest thing Lumsa asks of a user, and it deserves a plain,
 * specific account of what happens — including the things we *don't* do, which
 * are the parts people actually worry about.
 */

const PROVIDER_LABELS: Record<CalendarProvider, string> = {
  google: "Google Calendar",
  microsoft: "Outlook / Teams",
};

export function CalendarConnect({
  connections,
  configured,
  returnTo,
}: {
  connections: CalendarConnectionSummary[];
  configured: Record<CalendarProvider, boolean>;
  returnTo: string;
}) {
  const router = useRouter();
  const [disconnecting, setDisconnecting] = useState<CalendarProvider | null>(
    null,
  );

  async function disconnect(provider: CalendarProvider) {
    setDisconnecting(provider);
    await fetch("/api/calendar/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    });
    setDisconnecting(null);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2.5">
        {(["google", "microsoft"] as CalendarProvider[]).map((provider) => {
          const connection = connections.find((c) => c.provider === provider);
          const isConfigured = configured[provider];

          return (
            <div
              key={provider}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-text">
                  {PROVIDER_LABELS[provider]}
                </p>
                <p className="truncate text-[13px] text-muted">
                  {!isConfigured
                    ? "Not configured on this deployment"
                    : connection
                      ? connection.invalid_since
                        ? "Access expired — reconnect to resume"
                        : (connection.account_email ?? "Connected")
                      : "Not connected"}
                </p>
              </div>

              {connection ? (
                <div className="flex shrink-0 items-center gap-1">
                  {connection.invalid_since && (
                    <a
                      href={`/api/calendar/${provider}/connect?returnTo=${encodeURIComponent(returnTo)}`}
                      className="rounded-full px-3 py-1.5 text-[13px] font-medium text-gold hover:bg-gold-soft"
                    >
                      Reconnect
                    </a>
                  )}
                  <Button
                    variant="ghost"
                    onClick={() => disconnect(provider)}
                    loading={disconnecting === provider}
                    className="px-3 py-1.5 text-[13px]"
                  >
                    Disconnect
                  </Button>
                </div>
              ) : (
                <a
                  href={
                    isConfigured
                      ? `/api/calendar/${provider}/connect?returnTo=${encodeURIComponent(returnTo)}`
                      : undefined
                  }
                  aria-disabled={!isConfigured}
                  className={
                    isConfigured
                      ? "shrink-0 rounded-full border border-border px-4 py-1.5 text-[13px] font-medium text-text transition-colors hover:border-gold hover:text-gold"
                      : "pointer-events-none shrink-0 rounded-full border border-border px-4 py-1.5 text-[13px] text-faint opacity-50"
                  }
                >
                  Connect
                </a>
              )}
            </div>
          );
        })}
      </div>

      <CalendarDisclosure />
    </div>
  );
}

/**
 * What we read, what we keep, what we never do.
 *
 * Written as three plain lists rather than a paragraph, because people scan
 * this kind of thing rather than read it, and the "never" list is the one that
 * actually answers the question they're asking.
 */
export function CalendarDisclosure() {
  return (
    <div className="rounded-xl border border-border bg-surface-raised p-4 text-[13px] leading-relaxed">
      <p className="font-medium text-text">What Lumsa reads</p>
      <ul className="mt-2 space-y-1 text-muted">
        <li>· How many events you have today, and how tightly packed they are</li>
        <li>· Where the weight of the day falls, and your longest free stretch</li>
        <li>
          · Event titles — read in the moment to sense the day&rsquo;s tone, then
          discarded. They are never written to our database.
        </li>
      </ul>

      <p className="mt-3.5 font-medium text-text">What Lumsa never does</p>
      <ul className="mt-2 space-y-1 text-muted">
        <li>· Write, edit, or delete anything on your calendar — access is read-only</li>
        <li>· Store a copy of your calendar</li>
        <li>· Read attendees, locations, attachments, or meeting notes</li>
        <li>· Share any of it with anyone</li>
      </ul>

      <p className="mt-3.5 text-faint">
        Disconnecting removes your tokens immediately. You can also revoke access
        from your Google or Microsoft account settings at any time.
      </p>
    </div>
  );
}
