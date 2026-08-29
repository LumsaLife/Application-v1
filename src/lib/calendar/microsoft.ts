/**
 * Outlook / Teams calendar via Microsoft Graph, read-only.
 *
 * Mirrors the Google module's shape so src/lib/calendar/index.ts can treat the
 * two providers interchangeably. Defaults to the `common` tenant so both
 * personal Microsoft accounts and work/school accounts can connect.
 */

import { env } from "@/lib/env";
import type { NormalizedEvent } from "./signal";
import type { OAuthTokens } from "./google";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

/**
 * `offline_access` is what yields a refresh token; without it the connection
 * dies at the first access-token expiry and overnight generation stops.
 */
export const MICROSOFT_SCOPES = [
  "offline_access",
  "Calendars.Read",
  "User.Read",
];

function authority(): string {
  return `https://login.microsoftonline.com/${env.microsoftTenantId()}`;
}

export function microsoftRedirectUri(): string {
  return `${env.appUrl()}/api/calendar/microsoft/callback`;
}

export function buildMicrosoftAuthUrl(state: string): string {
  const clientId = env.microsoftClientId();
  if (!clientId) throw new Error("MICROSOFT_CLIENT_ID is not configured.");

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: microsoftRedirectUri(),
    response_mode: "query",
    scope: MICROSOFT_SCOPES.join(" "),
    state,
  });

  return `${authority()}/oauth2/v2.0/authorize?${params.toString()}`;
}

async function requestToken(body: URLSearchParams): Promise<OAuthTokens> {
  const response = await fetch(`${authority()}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    throw new Error(`Microsoft token request failed: ${await response.text()}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

export function exchangeMicrosoftCode(code: string): Promise<OAuthTokens> {
  return requestToken(
    new URLSearchParams({
      client_id: env.microsoftClientId()!,
      client_secret: env.microsoftClientSecret()!,
      code,
      redirect_uri: microsoftRedirectUri(),
      grant_type: "authorization_code",
      scope: MICROSOFT_SCOPES.join(" "),
    }),
  );
}

export function refreshMicrosoftToken(
  refreshToken: string,
): Promise<OAuthTokens> {
  return requestToken(
    new URLSearchParams({
      client_id: env.microsoftClientId()!,
      client_secret: env.microsoftClientSecret()!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: MICROSOFT_SCOPES.join(" "),
    }),
  );
}

export async function fetchMicrosoftAccountEmail(
  accessToken: string,
): Promise<string | null> {
  const response = await fetch(`${GRAPH_BASE}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;
  const data = await response.json();
  return data.mail ?? data.userPrincipalName ?? null;
}

/**
 * calendarView (rather than /events) is the endpoint that expands recurring
 * series into concrete instances within a window — the same reason we pass
 * singleEvents=true to Google.
 */
export async function fetchMicrosoftEvents(
  accessToken: string,
  start: Date,
  end: Date,
): Promise<NormalizedEvent[]> {
  const params = new URLSearchParams({
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString(),
    $select: "subject,start,end,isAllDay,responseStatus",
    $orderby: "start/dateTime",
    $top: "50",
  });

  const response = await fetch(
    `${GRAPH_BASE}/me/calendarView?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        // Ask Graph to return times in UTC so we can parse them without
        // interpreting each event's own timeZone field.
        Prefer: 'outlook.timezone="UTC"',
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Microsoft events fetch failed: ${await response.text()}`);
  }

  const data = await response.json();
  return (data.value ?? []).map(normalizeMicrosoftEvent);
}

interface MicrosoftEvent {
  subject?: string;
  isAllDay?: boolean;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  responseStatus?: { response?: string };
}

function normalizeMicrosoftEvent(item: MicrosoftEvent): NormalizedEvent {
  // Graph returns naive datetimes ("2026-08-29T14:00:00.0000000") that are UTC
  // because of the Prefer header above. Append Z so Date parses them as UTC
  // rather than as the server's local time.
  const parse = (value?: string) =>
    new Date(value ? (value.endsWith("Z") ? value : `${value}Z`) : 0);

  return {
    title: item.subject ?? "(untitled)",
    start: parse(item.start?.dateTime),
    end: parse(item.end?.dateTime),
    isAllDay: Boolean(item.isAllDay),
    isDeclined: item.responseStatus?.response === "declined",
  };
}
