import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildGoogleAuthUrl } from "@/lib/calendar/google";
import { issueState } from "@/lib/calendar/oauth-state";
import { calendarConfigured } from "@/lib/env";

export async function GET(request: NextRequest) {
  const { origin, searchParams } = request.nextUrl;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  if (!calendarConfigured.google()) {
    return NextResponse.redirect(
      `${origin}/settings?error=google_not_configured`,
    );
  }

  const returnTo = searchParams.get("returnTo") ?? "/settings";
  const state = await issueState(returnTo);

  return NextResponse.redirect(buildGoogleAuthUrl(state));
}
