import "server-only";

import crypto from "node:crypto";
import { cookies } from "next/headers";

/**
 * CSRF protection for the OAuth round trip.
 *
 * Without this, an attacker can hand a victim a crafted callback URL and
 * attach *their* calendar to the victim's Lumsa account — the victim then reads
 * meditations shaped by a stranger's schedule, and the attacker learns the
 * shape of the victim's practice. Cheap to prevent, so we prevent it.
 */

const COOKIE_NAME = "lumsa_oauth_state";

export async function issueState(returnTo: string): Promise<string> {
  const nonce = crypto.randomBytes(24).toString("base64url");
  const state = `${nonce}.${Buffer.from(returnTo).toString("base64url")}`;

  const store = await cookies();
  store.set(COOKIE_NAME, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // must survive the redirect back from the provider
    path: "/",
    maxAge: 600, // ten minutes is plenty for a consent screen
  });

  return state;
}

/**
 * Verify the state echoed back by the provider and return where to send the
 * user next. Returns null when it does not match.
 */
export async function consumeState(
  received: string | null,
): Promise<{ returnTo: string } | null> {
  const store = await cookies();
  const expected = store.get(COOKIE_NAME)?.value;

  store.delete(COOKIE_NAME);

  if (!received || !expected) return null;

  // Constant-time compare — these are equal-length strings we generated, and
  // there is no reason to leak timing on the nonce.
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const encodedReturn = received.split(".")[1] ?? "";
  const returnTo = Buffer.from(encodedReturn, "base64url").toString("utf8");

  // Only ever redirect within our own app.
  return { returnTo: returnTo.startsWith("/") ? returnTo : "/today" };
}
