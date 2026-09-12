import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { missingRequiredConfig } from "@/lib/env";
import { SetupRequired } from "@/components/SetupRequired";
import { OnboardingFlow } from "./OnboardingFlow";

/**
 * Never prerender. This page reads the session, and the config guard above
 * returns early without touching cookies() — which let Next prerender the
 * "finish setup" screen into the build and serve it forever, whatever the
 * runtime config said.
 */
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  // Check before touching Supabase: createClient() throws on missing config,
  // and an unhandled server exception reaches the visitor as an opaque digest.
  const missingConfig = missingRequiredConfig();
  if (missingConfig.length > 0) return <SetupRequired missing={missingConfig} />;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, onboarded_at")
    .eq("user_id", user.id)
    .maybeSingle();

  // Already done — no reason to make them answer again.
  if (profile?.onboarded_at) redirect("/today");

  return <OnboardingFlow initialName={profile?.display_name ?? ""} />;
}
