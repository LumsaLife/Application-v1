/**
 * Transactional email via Resend.
 *
 * One template, deliberately. The daily nudge is the only email Lumsa sends
 * that isn't an auth link (Supabase handles those), and an MVP does not need a
 * templating layer for one message.
 */

import "server-only";

import { Resend } from "resend";
import { env } from "./env";

let cached: Resend | null = null;

function resend(): Resend | null {
  const key = env.resendApiKey();
  if (!key) return null;
  cached ??= new Resend(key);
  return cached;
}

export function emailConfigured(): boolean {
  return Boolean(env.resendApiKey());
}

/**
 * The daily reminder.
 *
 * Leads with the "why this today" line rather than a generic nudge — that line
 * is the reason to open the app, so it belongs in the inbox where the decision
 * is actually made. Plain, quiet, one link.
 */
export async function sendDailyReminder(params: {
  to: string;
  displayName: string;
  whyToday: string;
  lengthMinutes: number;
}): Promise<boolean> {
  const client = resend();
  if (!client) return false;

  const appUrl = env.appUrl();
  const greeting = params.displayName ? `Good morning, ${params.displayName}` : "Good morning";

  const html = `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#faf6ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf6ef;padding:40px 20px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fffdf8;border:1px solid rgba(30,26,22,0.11);border-radius:16px;padding:32px;">
            <tr>
              <td>
                <p style="margin:0 0 24px;font-size:15px;color:#6b6154;">${escapeHtml(greeting)}</p>
                <p style="margin:0 0 28px;font-size:18px;line-height:1.6;color:#1e1a16;">
                  ${escapeHtml(params.whyToday)}
                </p>
                <a href="${appUrl}/today"
                   style="display:inline-block;background:#8a6410;color:#faf6ef;text-decoration:none;padding:12px 26px;border-radius:999px;font-size:14px;font-weight:500;">
                  Begin ${params.lengthMinutes} minutes
                </a>
                <p style="margin:28px 0 0;font-size:13px;line-height:1.6;color:#9a9082;">
                  You're getting this because daily reminders are on.
                  <a href="${appUrl}/settings" style="color:#8a6410;">Turn them off</a>.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();

  const text = [
    greeting,
    "",
    params.whyToday,
    "",
    `Begin ${params.lengthMinutes} minutes: ${appUrl}/today`,
    "",
    `Turn off reminders: ${appUrl}/settings`,
  ].join("\n");

  try {
    await client.emails.send({
      from: env.emailFrom(),
      to: params.to,
      subject: "Today's practice",
      html,
      text,
    });
    return true;
  } catch (error) {
    console.error("[email] send failed:", error);
    return false;
  }
}

/** Escapes user-supplied values before they go into the HTML template. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
