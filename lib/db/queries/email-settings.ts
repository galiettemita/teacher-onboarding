/**
 * Read access to the singleton `email_settings` row.
 *
 * Holds the deployment's verified outbound-mail identity — the display
 * name, the `from` address, and the portal URL teachers are pointed at.
 * The teacher-invite flow (`POST /api/admin/teachers`) reads it to build
 * the `from` header and the login link.
 *
 * The row is seeded by the initial migration at the well-known UUID
 * `00000000-0000-0000-0000-000000000001`. Code MUST handle "row missing"
 * by falling back to the documented defaults so the invite flow can still
 * render before the seed has run.
 */

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { emailSettings } from "@/lib/db/schema";

export const EMAIL_SETTINGS_ID = "00000000-0000-0000-0000-000000000001";

export interface EmailSettings {
  id: string;
  senderName: string;
  senderEmail: string;
  portalUrl: string;
}

/** Defaults to fall back on if the seed row is missing. */
export const DEFAULT_EMAIL_SETTINGS: EmailSettings = {
  id: EMAIL_SETTINGS_ID,
  senderName: "Onboarding Portal",
  senderEmail: "noreply@example.com",
  portalUrl: "http://localhost:3000",
};

/**
 * Load the settings row. Always returns a value — falls back to defaults
 * if the row is absent (which means the seed migration hasn't run yet).
 */
export async function getEmailSettings(): Promise<EmailSettings> {
  const rows = await db
    .select()
    .from(emailSettings)
    .where(eq(emailSettings.id, EMAIL_SETTINGS_ID))
    .limit(1);
  const r = rows[0];
  if (!r) return DEFAULT_EMAIL_SETTINGS;
  return {
    id: r.id,
    senderName: r.senderName,
    senderEmail: r.senderEmail,
    portalUrl: r.portalUrl,
  };
}
