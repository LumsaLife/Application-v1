import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Service-role Supabase client. BYPASSES ROW LEVEL SECURITY.
 *
 * Only for code paths with no signed-in user: the generation and reminder cron
 * jobs, and the OAuth callbacks that write encrypted tokens. Every query made
 * with this client must filter by user_id explicitly — RLS is not there to
 * catch you.
 *
 * The `server-only` import above makes it a build error to pull this into a
 * Client Component, which would leak the service-role key to the browser.
 */
export function createAdminClient() {
  return createSupabaseClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
