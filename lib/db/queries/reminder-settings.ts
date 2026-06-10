/**
 * Read/write access to the singleton `reminder_settings` row.
 *
 * The row is seeded by `scripts/seed.ts` at the well-known UUID
 * `00000000-0000-0000-0000-000000000001`. Code MUST handle "row missing"
 * by falling back to the documented defaults so the cron can still run
 * (with disabled=true off) and admin pages can render before seed.
 */

import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { reminderSettings } from "@/lib/db/schema";
import { auditLog } from "@/lib/audit/log";
import { ForbiddenError, ValidationError } from "@/lib/errors";

export const REMINDER_SETTINGS_ID = "00000000-0000-0000-0000-000000000001";

export interface ReminderSettings {
  id: string;
  enabled: boolean;
  senderName: string;
  senderEmail: string;
  portalUrl: string;
  reminderDaysBeforeExpiration: number[];
  postExpirationIntervalDays: number;
  maxOneEmailPerTeacherPerDay: boolean;
  pendingReviewDaysBeforeAdminAlert: number | null;
  missingDocReminderIntervalDays: number;
  rejectedDocReminderIntervalDays: number;
}

/** Defaults to fall back on if the seed row is missing. Match §3.6. */
export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  id: REMINDER_SETTINGS_ID,
  enabled: true,
  senderName: "Onboarding Portal",
  senderEmail: "noreply@example.com",
  portalUrl: "http://localhost:3000",
  reminderDaysBeforeExpiration: [90, 60, 30, 14, 7],
  postExpirationIntervalDays: 7,
  maxOneEmailPerTeacherPerDay: true,
  pendingReviewDaysBeforeAdminAlert: null,
  missingDocReminderIntervalDays: 14,
  rejectedDocReminderIntervalDays: 7,
};

/**
 * Load the settings row. Always returns a value — falls back to defaults
 * if the row is absent (which means the seed migration hasn't run yet).
 */
export async function getReminderSettings(): Promise<ReminderSettings> {
  const rows = await db
    .select()
    .from(reminderSettings)
    .where(eq(reminderSettings.id, REMINDER_SETTINGS_ID))
    .limit(1);
  const r = rows[0];
  if (!r) return DEFAULT_REMINDER_SETTINGS;
  return {
    id: r.id,
    enabled: r.enabled,
    senderName: r.senderName,
    senderEmail: r.senderEmail,
    portalUrl: r.portalUrl,
    reminderDaysBeforeExpiration: r.reminderDaysBeforeExpiration,
    postExpirationIntervalDays: r.postExpirationIntervalDays,
    maxOneEmailPerTeacherPerDay: r.maxOneEmailPerTeacherPerDay,
    pendingReviewDaysBeforeAdminAlert: r.pendingReviewDaysBeforeAdminAlert,
    missingDocReminderIntervalDays: r.missingDocReminderIntervalDays,
    rejectedDocReminderIntervalDays: r.rejectedDocReminderIntervalDays,
  };
}

/**
 * Settings fields editable from the admin UI. We do NOT expose `id` or
 * `created_at`; `updated_at` is set server-side.
 */
export type ReminderSettingsPatch = Partial<
  Omit<ReminderSettings, "id"> & { enabled: boolean }
>;

function assertAdmin(actor: { role: string }) {
  if (actor.role !== "admin") throw new ForbiddenError("Admin role required");
}

const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$/;
const URL_RE = /^https?:\/\/[^\s]+$/;

function validatePatch(patch: ReminderSettingsPatch): void {
  if (patch.senderName !== undefined) {
    if (patch.senderName.trim().length === 0 || patch.senderName.length > 100) {
      throw new ValidationError("senderName must be 1-100 chars");
    }
  }
  if (patch.senderEmail !== undefined) {
    if (!EMAIL_RE.test(patch.senderEmail)) {
      throw new ValidationError("senderEmail must be a valid email address");
    }
  }
  if (patch.portalUrl !== undefined) {
    if (!URL_RE.test(patch.portalUrl) || patch.portalUrl.length > 500) {
      throw new ValidationError("portalUrl must be an http(s) URL");
    }
  }
  if (patch.reminderDaysBeforeExpiration !== undefined) {
    const arr = patch.reminderDaysBeforeExpiration;
    if (!Array.isArray(arr) || arr.length === 0 || arr.length > 20) {
      throw new ValidationError("reminderDaysBeforeExpiration must be a non-empty list");
    }
    for (const n of arr) {
      if (!Number.isInteger(n) || n <= 0 || n > 365) {
        throw new ValidationError("each milestone day must be 1-365");
      }
    }
  }
  for (const k of [
    "postExpirationIntervalDays",
    "missingDocReminderIntervalDays",
    "rejectedDocReminderIntervalDays",
  ] as const) {
    if (patch[k] !== undefined) {
      const n = patch[k];
      if (!Number.isInteger(n) || (n as number) <= 0 || (n as number) > 365) {
        throw new ValidationError(`${k} must be 1-365`);
      }
    }
  }
  if (patch.pendingReviewDaysBeforeAdminAlert !== undefined) {
    const n = patch.pendingReviewDaysBeforeAdminAlert;
    if (n !== null && (!Number.isInteger(n) || n <= 0 || n > 365)) {
      throw new ValidationError("pendingReviewDaysBeforeAdminAlert must be null or 1-365");
    }
  }
}

/**
 * Upsert the settings row from the admin UI. Writes an audit row via the
 * single chokepoint helper (§8 rule 13).
 *
 * The route handler is responsible for verifying the actor is an admin
 * BEFORE calling this; we re-check inside as defence in depth (per
 * REVIEWER_NOTES "boundary tests beat unit tests").
 */
export async function updateReminderSettings(
  actor: { id: string; role: string },
  patch: ReminderSettingsPatch
): Promise<ReminderSettings> {
  assertAdmin(actor);
  validatePatch(patch);

  // Upsert by primary key. We seed in Phase 1; if the row is missing
  // (fresh DB without seed) we insert a complete row from defaults +
  // patch so subsequent reads work.
  const merged = { ...DEFAULT_REMINDER_SETTINGS, ...patch };

  await db
    .insert(reminderSettings)
    .values({
      id: REMINDER_SETTINGS_ID,
      enabled: merged.enabled,
      senderName: merged.senderName,
      senderEmail: merged.senderEmail,
      portalUrl: merged.portalUrl,
      reminderDaysBeforeExpiration: merged.reminderDaysBeforeExpiration,
      postExpirationIntervalDays: merged.postExpirationIntervalDays,
      maxOneEmailPerTeacherPerDay: merged.maxOneEmailPerTeacherPerDay,
      pendingReviewDaysBeforeAdminAlert: merged.pendingReviewDaysBeforeAdminAlert,
      missingDocReminderIntervalDays: merged.missingDocReminderIntervalDays,
      rejectedDocReminderIntervalDays: merged.rejectedDocReminderIntervalDays,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: reminderSettings.id,
      set: {
        ...patch,
        updatedAt: new Date(),
      },
    });

  // Distinguish "only the master toggle changed" from a general update
  // so the audit log can power the "who flipped the switch" view.
  const onlyToggle =
    Object.keys(patch).length === 1 &&
    Object.prototype.hasOwnProperty.call(patch, "enabled");
  await auditLog({
    actorId: actor.id,
    action: onlyToggle ? "reminders.toggle" : "reminders.settings.update",
    targetType: "reminder_settings",
    targetId: REMINDER_SETTINGS_ID,
    metadata: { changed: Object.keys(patch) },
  });

  return getReminderSettings();
}
