import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteConnection } from "@/lib/calendar";
import type { CalendarProvider } from "@/lib/types";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { provider } = (await request.json()) as { provider: CalendarProvider };
  if (provider !== "google" && provider !== "microsoft") {
    return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  }

  await deleteConnection(user.id, provider);
  return NextResponse.json({ ok: true });
}
