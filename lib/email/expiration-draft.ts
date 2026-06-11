import { getEmailSettings } from "@/lib/db/queries/email-settings";
import {
  renderExpirationReminder,
  type ExpirationReminderDocument,
} from "@/lib/email/templates/expiration-reminder";
import type { ExpirationItem } from "@/lib/db/queries/expiration";

/**
 * Build a copyable renewal-reminder draft for ONE teacher.
 *
 * Mirrors `buildInvitation`: the portal sends no email — it hands the admin a
 * ready-to-send draft listing only that teacher's expired / expiring-soon
 * documents. Returns `null` when there is nothing to remind about, so the UI
 * can show "no reminder needed" instead of an empty draft.
 */
export interface ExpirationDraft {
  subject: string;
  text: string;
}

/** Format an expiry date as friendly long-form, e.g. "August 12, 2026". */
export function formatExpiryDate(d: Date | null): string {
  if (!d) return "an upcoming date";
  return new Date(d).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export async function buildExpirationDraft(args: {
  teacherName: string;
  items: ExpirationItem[];
}): Promise<ExpirationDraft | null> {
  if (args.items.length === 0) return null;

  const settings = await getEmailSettings();
  const origin = (process.env.AUTH_URL ?? settings.portalUrl ?? "http://localhost:3000")
    .trim()
    .replace(/\/+$/, "");
  const loginUrl = `${origin}/login`;

  const documents: ExpirationReminderDocument[] = args.items.map((it) => ({
    name: it.documentTypeName,
    expiresOn: formatExpiryDate(it.expiresAt),
    expired: it.state === "expired",
  }));

  const rendered = renderExpirationReminder({
    teacher: { name: args.teacherName },
    settings: { schoolName: settings.senderName, portalUrl: loginUrl },
    documents,
  });

  return { subject: rendered.subject, text: rendered.text };
}
