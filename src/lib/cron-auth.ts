import "server-only";

import crypto from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Authenticate a cron request.
 *
 * These endpoints run as the service role and generate paid API calls, so they
 * cannot be open. Vercel Cron sends `Authorization: Bearer $CRON_SECRET`
 * automatically when that env var is set on the project.
 */
export function isAuthorizedCron(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";

  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
