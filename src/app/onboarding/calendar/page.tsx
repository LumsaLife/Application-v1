import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CalendarConnect } from "@/components/CalendarConnect";
import { Logo } from "@/components/Logo";
import { calendarConfigured } from "@/lib/env";
import type { CalendarConnectionSummary } from "@/lib/types";

/**
 * The last onboarding step, and the only optional one.
 *
 * Skipping is a first-class choice, not a grey afterthought link — a calendar is
 * a lot to ask for on day one, and Lumsa still works without it.
 */
export default async function OnboardingCalendarPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data } = await admin
    .from("calendar_connections")
    .select("id, provider, account_email, connected_at, last_synced_at, invalid_since")
    .eq("user_id", user.id);

  const connections = (data ?? []) as CalendarConnectionSummary[];

  return (
    <main className="flex min-h-dvh flex-col px-6 py-10">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <span className="text-gold">
          <Logo size={26} />
        </span>

        <div className="animate-fade-up flex-1 space-y-7 pt-12">
          <div className="space-y-2.5">
            <h1 className="font-display text-[1.6rem] leading-snug text-text">
              Shall Lumsa look at your day?
            </h1>
            <p className="text-[15px] leading-relaxed text-muted">
              This is what makes each practice about <em>today</em> rather than
              any day. It&rsquo;s read-only, and you can disconnect whenever you
              like.
            </p>
          </div>

          <CalendarConnect
            connections={connections}
            configured={{
              google: calendarConfigured.google(),
              microsoft: calendarConfigured.microsoft(),
            }}
            returnTo="/onboarding/calendar"
          />
        </div>

        <div className="flex items-center justify-between gap-3 pt-8">
          <Link
            href="/today"
            className="rounded-full px-4 py-2.5 text-sm text-muted transition-colors hover:text-text"
          >
            {connections.length > 0 ? "Done" : "Skip for now"}
          </Link>
          <Link
            href="/today"
            className="inline-flex items-center justify-center rounded-full bg-gold px-5 py-2.5 text-sm font-medium text-canvas transition-all hover:bg-gold-bright active:scale-[0.985]"
          >
            Go to today
          </Link>
        </div>
      </div>
    </main>
  );
}
