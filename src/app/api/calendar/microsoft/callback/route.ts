import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  MICROSOFT_SCOPES,
  exchangeMicrosoftCode,
  fetchMicrosoftAccountEmail,
} from "@/lib/calendar/microsoft";
import { saveConnection } from "@/lib/calendar";
import { consumeState } from "@/lib/calendar/oauth-state";

export async function GET(request: NextRequest) {
  const { origin, searchParams } = request.nextUrl;

  const verified = await consumeState(searchParams.get("state"));
  if (!verified) {
    return NextResponse.redirect(`${origin}/settings?error=invalid_state`);
  }
  const { returnTo } = verified;

  const denied = searchParams.get("error");
  if (denied) {
    return NextResponse.redirect(`${origin}${returnTo}?calendar=cancelled`);
  }

  const code = searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(`${origin}${returnTo}?error=missing_code`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  try {
    const tokens = await exchangeMicrosoftCode(code);
    const accountEmail = await fetchMicrosoftAccountEmail(tokens.accessToken);

    await saveConnection({
      userId: user.id,
      provider: "microsoft",
      tokens,
      accountEmail,
      scopes: MICROSOFT_SCOPES,
    });

    return NextResponse.redirect(`${origin}${returnTo}?calendar=connected`);
  } catch (error) {
    console.error("[calendar] Microsoft connect failed:", error);
    return NextResponse.redirect(`${origin}${returnTo}?error=connect_failed`);
  }
}
