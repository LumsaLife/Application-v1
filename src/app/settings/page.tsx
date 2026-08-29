import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AppNav } from "@/components/AppNav";
import { calendarConfigured } from "@/lib/env";
import type { CalendarConnectionSummary, Profile } from "@/lib/types";
import { SettingsForm } from "./SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!profileRow?.onboarded_at) redirect("/onboarding");

  // Read connections with the admin client and project away the token columns,
  // so ciphertext never crosses the server/client boundary.
  const admin = createAdminClient();
  const { data: connectionRows } = await admin
    .from("calendar_connections")
    .select("id, provider, account_email, connected_at, last_synced_at, invalid_since")
    .eq("user_id", user.id);

  return (
    <div className="min-h-dvh pb-24 sm:pb-10">
      <AppNav current="settings" />

      <main className="mx-auto max-w-2xl px-6 pt-10 sm:pt-14">
        <div className="animate-fade-up space-y-8">
          <header>
            <h1 className="font-display text-[1.75rem] text-text">Settings</h1>
          </header>

          <SettingsForm
            profile={profileRow as Profile}
            connections={(connectionRows ?? []) as CalendarConnectionSummary[]}
            configured={{
              google: calendarConfigured.google(),
              microsoft: calendarConfigured.microsoft(),
            }}
          />
        </div>
      </main>
    </div>
  );
}
