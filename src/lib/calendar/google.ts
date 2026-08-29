/**
 * Google Calendar, read-only.
 *
 * We run our own OAuth flow rather than using Supabase's Google provider. The
 * Supabase provider issues a sign-in token: it carries no `calendar.readonly`
 * scope and no durable refresh token, so it cannot read a calendar tomorrow
 * morning while the user is asleep. Those are separate concerns and we keep
 * them separate — a user can sign in with a magic link and connect a Google
 * calendar belonging to a different account.
 */

import { env } from "@/lib/env";
import type { NormalizedEvent } from "./signal";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const EVENTS_ENDPOINT =
  "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v2/userinfo";

/** Read-only, and nothing beyond it. Reflected verbatim in the consent UI copy. */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

export function googleRedirectUri(): string {
  return `${env.appUrl()}/api/calendar/google/callback`;
}

export function buildGoogleAuthUrl(state: string): string {
  const clientId = env.googleClientId();
  if (!clientId) throw new Error("GOOGLE_CLIENT_ID is not configured.");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    // offline + consent is what actually yields a refresh token. Without
    // prompt=consent Google omits it on every re-authorisation after the first,
    // which silently breaks overnight generation for returning users.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });

  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
}

export async function exchangeGoogleCode(code: string): Promise<OAuthTokens> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.googleClientId()!,
      client_secret: env.googleClientSecret()!,
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    throw new Error(`Google token exchange failed: ${await response.text()}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

export async function refreshGoogleToken(
  refreshToken: string,
): Promise<OAuthTokens> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.googleClientId()!,
      client_secret: env.googleClientSecret()!,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    throw new Error(`Google token refresh failed: ${await response.text()}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    // Google does not reissue the refresh token on refresh; the caller keeps
    // the one it already has.
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

export async function fetchGoogleAccountEmail(
  accessToken: string,
): Promise<string | null> {
  const response = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;
  const data = await response.json();
  return data.email ?? null;
}

/** Fetch the primary calendar's events between two instants. */
export async function fetchGoogleEvents(
  accessToken: string,
  start: Date,
  end: Date,
): Promise<NormalizedEvent[]> {
  const params = new URLSearchParams({
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    // Expands recurring events into individual instances — without this a
    // weekly standup appears once, as its series definition.
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "50",
  });

  const response = await fetch(`${EVENTS_ENDPOINT}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Google events fetch failed: ${await response.text()}`);
  }

  const data = await response.json();
  return (data.items ?? [])
    .filter((item: GoogleEvent) => item.status !== "cancelled")
    .map(normalizeGoogleEvent);
}

interface GoogleEvent {
  summary?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
}

function normalizeGoogleEvent(item: GoogleEvent): NormalizedEvent {
  const isAllDay = Boolean(item.start?.date);
  const startRaw = item.start?.dateTime ?? item.start?.date;
  const endRaw = item.end?.dateTime ?? item.end?.date;

  // `self` marks the row representing the signed-in user among the attendees.
  const self = item.attendees?.find((a) => a.self);

  return {
    title: item.summary ?? "(untitled)",
    start: new Date(startRaw ?? 0),
    end: new Date(endRaw ?? startRaw ?? 0),
    isAllDay,
    isDeclined: self?.responseStatus === "declined",
  };
}
