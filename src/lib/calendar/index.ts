/**
 * Provider-agnostic calendar access.
 *
 * Everything above this module deals in `CalendarSignal`, never in Google or
 * Microsoft specifics. This is also the only place that decrypts refresh
 * tokens, so the blast radius of a token bug stays small.
 */

import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { decrypt, encrypt } from "@/lib/crypto";
import { localDayBounds } from "@/lib/time";
import type { CalendarProvider, CalendarSignal } from "@/lib/types";
import {
  fetchGoogleEvents,
  refreshGoogleToken,
  type OAuthTokens,
} from "./google";
import { fetchMicrosoftEvents, refreshMicrosoftToken } from "./microsoft";
import { buildCalendarSignal, EMPTY_SIGNAL, type NormalizedEvent } from "./signal";

/** Refresh a little early so a token can't expire mid-request. */
const EXPIRY_SKEW_MS = 60_000;

interface ConnectionRow {
  id: string;
  provider: CalendarProvider;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string;
  access_token_expires_at: string | null;
  invalid_since: string | null;
}

/**
 * Persist a freshly-authorised connection. Called from both OAuth callbacks.
 *
 * Upserts on (user_id, provider): reconnecting an account replaces the old
 * tokens rather than accumulating rows.
 */
export async function saveConnection(params: {
  userId: string;
  provider: CalendarProvider;
  tokens: OAuthTokens;
  accountEmail: string | null;
  scopes: string[];
}): Promise<void> {
  const { userId, provider, tokens, accountEmail, scopes } = params;

  if (!tokens.refreshToken) {
    // Without a refresh token the connection is useless for overnight
    // generation — fail loudly at connect time rather than at 5am.
    throw new Error(
      `${provider} did not return a refresh token. The user may need to revoke ` +
        `prior access and reconnect.`,
    );
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from("calendar_connections").upsert(
    {
      user_id: userId,
      provider,
      access_token_encrypted: encrypt(tokens.accessToken),
      refresh_token_encrypted: encrypt(tokens.refreshToken),
      access_token_expires_at: tokens.expiresAt.toISOString(),
      account_email: accountEmail,
      scopes,
      connected_at: new Date().toISOString(),
      invalid_since: null,
    },
    { onConflict: "user_id,provider" },
  );

  if (error) throw new Error(`Failed to save connection: ${error.message}`);
}

export async function deleteConnection(
  userId: string,
  provider: CalendarProvider,
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("calendar_connections")
    .delete()
    .eq("user_id", userId)
    .eq("provider", provider);

  if (error) throw new Error(`Failed to disconnect: ${error.message}`);
}

/**
 * Return a usable access token, refreshing it if it has expired.
 * Returns null when the connection is broken — the caller degrades to a
 * calendar-free meditation rather than failing the whole generation.
 */
async function getAccessToken(row: ConnectionRow): Promise<string | null> {
  const expiresAt = row.access_token_expires_at
    ? new Date(row.access_token_expires_at).getTime()
    : 0;

  if (row.access_token_encrypted && expiresAt - EXPIRY_SKEW_MS > Date.now()) {
    return decrypt(row.access_token_encrypted);
  }

  const supabase = createAdminClient();

  try {
    const refreshToken = decrypt(row.refresh_token_encrypted);
    const refreshed =
      row.provider === "google"
        ? await refreshGoogleToken(refreshToken)
        : await refreshMicrosoftToken(refreshToken);

    await supabase
      .from("calendar_connections")
      .update({
        access_token_encrypted: encrypt(refreshed.accessToken),
        access_token_expires_at: refreshed.expiresAt.toISOString(),
        // Microsoft rotates refresh tokens on every use; Google does not.
        // Persist a new one whenever the provider gives us one.
        ...(refreshed.refreshToken
          ? { refresh_token_encrypted: encrypt(refreshed.refreshToken) }
          : {}),
        invalid_since: null,
      })
      .eq("id", row.id);

    return refreshed.accessToken;
  } catch (error) {
    // A refresh failure usually means the user revoked access or changed their
    // password. Mark it so Settings can prompt a reconnect instead of the app
    // silently producing calendar-free meditations forever.
    console.error(`[calendar] refresh failed for ${row.provider}:`, error);
    await supabase
      .from("calendar_connections")
      .update({ invalid_since: new Date().toISOString() })
      .eq("id", row.id);
    return null;
  }
}

/**
 * Build today's calendar signal for a user, across every connected provider.
 *
 * Never throws for calendar reasons: a user whose Google token was revoked
 * should still get a meditation this morning, just one that doesn't reference
 * their day.
 */
export async function getTodaySignal(params: {
  userId: string;
  localDate: string;
  timeZone: string;
  includeTitles: boolean;
}): Promise<CalendarSignal> {
  const { userId, localDate, timeZone, includeTitles } = params;
  const supabase = createAdminClient();

  const { data: rows, error } = await supabase
    .from("calendar_connections")
    .select(
      "id, provider, access_token_encrypted, refresh_token_encrypted, access_token_expires_at, invalid_since",
    )
    .eq("user_id", userId);

  if (error) {
    console.error("[calendar] failed to load connections:", error.message);
    return EMPTY_SIGNAL;
  }
  if (!rows || rows.length === 0) return EMPTY_SIGNAL;

  const { start, end } = localDayBounds(localDate, timeZone);
  const events: NormalizedEvent[] = [];
  let anySucceeded = false;

  for (const row of rows as ConnectionRow[]) {
    const accessToken = await getAccessToken(row);
    if (!accessToken) continue;

    try {
      const providerEvents =
        row.provider === "google"
          ? await fetchGoogleEvents(accessToken, start, end)
          : await fetchMicrosoftEvents(accessToken, start, end);

      events.push(...providerEvents);
      anySucceeded = true;

      await supabase
        .from("calendar_connections")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", row.id);
    } catch (fetchError) {
      console.error(`[calendar] ${row.provider} fetch failed:`, fetchError);
    }
  }

  // Every connection is broken — treat it as "no calendar" so the prompt takes
  // the calendar-free branch rather than claiming the user has an empty day.
  if (!anySucceeded) return EMPTY_SIGNAL;

  return buildCalendarSignal(events, timeZone, includeTitles);
}
