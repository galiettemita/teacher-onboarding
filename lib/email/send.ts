/**
 * Email provider dispatcher.
 *
 * EVERYTHING that sends mail goes through `sendEmail`. There is no other
 * exit. Tests assert this by mocking `@/lib/email/send` and capturing
 * every payload (PROJECT_CONTEXT §11.8 privacy assertions).
 *
 * Provider selection is by env var:
 *
 *   EMAIL_PROVIDER=console  (default) — prints the payload to stdout, no
 *                                       network. Suitable for dev + the
 *                                       smoke script.
 *   EMAIL_PROVIDER=resend             — POSTs to Resend's REST API using
 *                                       RESEND_API_KEY. Server-only.
 *
 * Hard rules enforced here:
 *
 *  - Single recipient. No `cc`, `bcc`, array `to`, or `replyTo` override
 *    from the caller. The `EmailMessage` type closes those holes at the
 *    type level.
 *  - All fields pass through `lib/email/sanitize.ts` for header-injection
 *    defence before any provider call.
 *  - When EMAIL_PROVIDER=resend, RESEND_API_KEY MUST be set; we throw on
 *    first use if it's missing. No silent fallback to console — that's
 *    how production goes silent.
 *  - The `from` field is built server-side from `reminder_settings`, NOT
 *    accepted from the caller. The dispatcher takes a `from` field only
 *    because `reminder_settings` is the only thing that legitimately
 *    knows the verified sender for the deployment; the dispatcher then
 *    re-sanitises it.
 *
 * Cited platform doc:
 *   Resend Send API — https://resend.com/docs/api-reference/emails/send-email
 *   (uses Authorization: Bearer <RESEND_API_KEY>, JSON body, fields:
 *    from, to, subject, text, html)
 */

import {
  buildFromHeader,
  sanitizeRecipient,
  sanitizeSubject,
  sanitizeTextBody,
  sanitizeHtmlBody,
  sanitizeDisplayName,
  HeaderInjectionError,
} from "./sanitize";

/**
 * The payload contract. Deliberately narrow:
 *  - `to`: single string only (no array). The type forbids lists.
 *  - `from`: { name, email } — built by the dispatcher's caller from
 *    `reminder_settings`. Never user-controlled.
 *  - `subject`, `text`, `html` as expected.
 *  - No `cc`, `bcc`, `replyTo`, `attachments`, `headers`.
 *
 * Note the absence of `attachments` is load-bearing: PROJECT_CONTEXT
 * §11.3 rule 1 says emails NEVER carry files. The type makes that
 * impossible.
 */
export interface EmailMessage {
  to: string;
  from: { name: string; email: string };
  subject: string;
  text: string;
  html?: string;
}

export interface SendResult {
  ok: boolean;
  /** Provider-side identifier; for the console provider, a synthetic UUID. */
  providerId?: string;
  /** Sanitised error message — never includes the API key or full response. */
  error?: string;
}

/**
 * Read the provider selection from env. Defaults to `console`. Anything
 * unrecognised is treated as a misconfiguration and we throw — silent
 * fall-through to console would be a production foot-gun.
 */
export function readEmailProvider(): "console" | "resend" {
  const raw = (process.env.EMAIL_PROVIDER ?? "console").trim().toLowerCase();
  if (raw === "console" || raw === "") return "console";
  if (raw === "resend") return "resend";
  throw new Error(
    `Unsupported EMAIL_PROVIDER='${raw}'. Set EMAIL_PROVIDER to 'console' or 'resend'.`
  );
}

export function inviteEmailDeliveryEnabled(): boolean {
  return readEmailProvider() === "resend";
}

function readResendApiKey(): string {
  const key = process.env.RESEND_API_KEY;
  if (!key || key.trim().length === 0) {
    // Fail-loud per PROJECT_CONTEXT §11 and the prompt. A silent no-op
    // when the secretary expects emails to go out is the worst possible
    // failure mode.
    throw new Error(
      "RESEND_API_KEY is not set but EMAIL_PROVIDER=resend. Refusing to send."
    );
  }
  return key;
}

/**
 * Console provider — prints the payload to stdout. The output is
 * structured (one JSON line per send) so the smoke script can grep it
 * deterministically.
 *
 * Returns immediately with a synthetic providerId so callers can record
 * "we processed this" in `notification_logs` regardless of provider.
 */
function sendViaConsole(msg: EmailMessage): SendResult {
  const id = `console-${crypto.randomUUID()}`;
  const payload = {
    provider: "console",
    id,
    to: msg.to,
    from: buildFromHeader(msg.from.name, msg.from.email),
    subject: msg.subject,
    text: msg.text,
    html: msg.html ?? null,
  };
  // Single line, no secrets, no PII beyond what's in the email itself.
  // eslint-disable-next-line no-console
  console.log(`[email:console] ${JSON.stringify(payload)}`);
  return { ok: true, providerId: id };
}

/**
 * Resend provider — POSTs to https://api.resend.com/emails.
 * Doc: https://resend.com/docs/api-reference/emails/send-email
 *
 * Errors are surfaced as `{ ok: false, error }` with a SANITISED message
 * — we strip the API key from any echo, and we cap the length. The
 * caller (`dispatcher.ts`) writes this string into
 * `notification_logs.failed_reason` so it must be safe to persist.
 */
async function sendViaResend(msg: EmailMessage): Promise<SendResult> {
  const apiKey = readResendApiKey();

  const body = JSON.stringify({
    from: buildFromHeader(msg.from.name, msg.from.email),
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    ...(msg.html ? { html: msg.html } : {}),
  });

  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body,
    });
  } catch (err) {
    // Network-level failure (DNS, TLS, etc.). Don't leak the URL stack.
    return {
      ok: false,
      error: scrubError(err instanceof Error ? err.message : String(err), apiKey),
    };
  }

  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    // Provider returned non-JSON; we still want a useful status code.
  }

  if (res.ok) {
    const id =
      parsed && typeof parsed === "object" && "id" in parsed
        ? String((parsed as { id: unknown }).id)
        : undefined;
    return { ok: true, providerId: id };
  }

  const providerMessage =
    parsed && typeof parsed === "object" && "message" in parsed
      ? String((parsed as { message: unknown }).message)
      : `HTTP ${res.status}`;
  return {
    ok: false,
    error: scrubError(providerMessage, apiKey),
  };
}

/**
 * Defensive scrubber for anything we surface in `failed_reason`. Kills
 * any echo of the API key (paranoia — Resend doesn't echo it, but our
 * own code might) and truncates.
 */
function scrubError(raw: string, apiKey: string): string {
  let s = raw;
  if (apiKey) s = s.split(apiKey).join("***");
  // Cut anything that looks like a header dump.
  s = s.replace(/Authorization:[^\s]*/gi, "Authorization: ***");
  return s.slice(0, 500);
}

/**
 * The one and only entry point. Sanitises every field, dispatches to the
 * configured provider, returns a normalised result. Never throws on
 * provider errors — the dispatcher wants to record the failure, not
 * unwind the cron run.
 *
 * Sanitisation errors (HeaderInjectionError) DO throw, because they
 * indicate the caller built a payload we should never persist; the
 * dispatcher catches and records them as `failed` with the reason.
 */
export async function sendEmail(msg: EmailMessage): Promise<SendResult> {
  // Sanitise everything up front. These will throw HeaderInjectionError
  // on bad input — that's a programmer / data error, not a provider
  // error.
  const safeTo = sanitizeRecipient(msg.to);
  const safeFromName = sanitizeDisplayName(msg.from.name);
  const safeFromEmail = sanitizeRecipient(msg.from.email);
  const safeSubject = sanitizeSubject(msg.subject);
  const safeText = sanitizeTextBody(msg.text);
  const safeHtml = sanitizeHtmlBody(msg.html);

  const safe: EmailMessage = {
    to: safeTo,
    from: { name: safeFromName, email: safeFromEmail },
    subject: safeSubject,
    text: safeText,
    ...(safeHtml ? { html: safeHtml } : {}),
  };

  const provider = readEmailProvider();
  if (provider === "console") return sendViaConsole(safe);
  return sendViaResend(safe);
}

export { HeaderInjectionError };
