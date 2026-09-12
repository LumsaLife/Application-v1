import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { missingRequiredConfig } from "@/lib/env";
import { SetupRequired } from "@/components/SetupRequired";
import { AppNav } from "@/components/AppNav";
import type { Mood } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Row shape returned by the join below. */
interface JournalRow {
  id: string;
  reflection_text: string | null;
  mood: Mood | null;
  created_at: string;
  daily_meditations: { why_today: string; local_date: string } | null;
}

const MOOD_LABELS: Record<Mood, string> = {
  heavy: "Heavy",
  tender: "Tender",
  steady: "Steady",
  light: "Light",
  radiant: "Radiant",
};

export default async function JournalPage() {
  // Check before touching Supabase: createClient() throws on missing config,
  // and an unhandled server exception reaches the visitor as an opaque digest.
  const missingConfig = missingRequiredConfig();
  if (missingConfig.length > 0) return <SetupRequired missing={missingConfig} />;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS scopes this to the signed-in user; no explicit user_id filter needed,
  // though we keep one for clarity and so the index is used.
  const { data } = await supabase
    .from("journal_entries")
    .select(
      "id, reflection_text, mood, created_at, daily_meditations(why_today, local_date)",
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(60);

  const entries = (data ?? []) as unknown as JournalRow[];

  return (
    <div className="min-h-dvh pb-24 sm:pb-10">
      <AppNav current="journal" />

      <main className="mx-auto max-w-2xl px-6 pt-10 sm:pt-14">
        <div className="animate-fade-up space-y-8">
          <header className="space-y-2">
            <h1 className="font-display text-[1.75rem] text-text">Journal</h1>
            <p className="text-[15px] leading-relaxed text-muted">
              What you noticed after each practice.
            </p>
          </header>

          {entries.length === 0 ? (
            <div className="rounded-2xl border border-border bg-surface p-6">
              <p className="text-[15px] leading-relaxed text-muted">
                Nothing here yet. After a practice you&rsquo;ll be asked how you
                feel — anything you write shows up here.
              </p>
            </div>
          ) : (
            <ol className="space-y-3">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="rounded-2xl border border-border bg-surface p-5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <time
                      dateTime={entry.created_at}
                      className="text-[13px] text-faint"
                    >
                      {formatEntryDate(entry.created_at)}
                    </time>
                    {entry.mood && (
                      <span className="rounded-full bg-gold-soft px-2.5 py-0.5 text-[12px] font-medium text-gold">
                        {MOOD_LABELS[entry.mood]}
                      </span>
                    )}
                  </div>

                  {entry.reflection_text && (
                    <p className="mt-2.5 whitespace-pre-wrap text-[15px] leading-relaxed text-text">
                      {entry.reflection_text}
                    </p>
                  )}

                  {entry.daily_meditations?.why_today && (
                    <p className="mt-3 border-t border-border pt-3 text-[13px] leading-relaxed text-faint">
                      {entry.daily_meditations.why_today}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </main>
    </div>
  );
}

function formatEntryDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}
