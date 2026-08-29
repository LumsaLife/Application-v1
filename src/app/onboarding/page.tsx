import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OnboardingFlow } from "./OnboardingFlow";

export default async function OnboardingPage() {
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
