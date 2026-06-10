/**
 * Template registry.
 *
 * Maps a `reminder_type` to its template module. Centralises the only
 * place the dispatcher needs to know about template files; also gives
 * the admin preview page a single source of truth for "what types
 * exist."
 *
 * Each entry exports a `render` function over the type's specific
 * context shape. The dispatcher narrows the context union to the right
 * type by `reminderType` before calling.
 */

import type {
  BaseCtx,
  ExpiryCtx,
  ExpiredCtx,
  ExpiredRecurringCtx,
  AdminAlertCtx,
  RenderedEmail,
} from "./base";
import {
  SAMPLE_TEACHER,
  SAMPLE_DOC_TYPE,
  SAMPLE_SETTINGS,
} from "./base";
import { render as renderMissingRequired } from "./missing-required";
import { render as renderRejectedReplace } from "./rejected-replace";
import { render as renderExpiring90 } from "./expiring-90";
import { render as renderExpiring60 } from "./expiring-60";
import { render as renderExpiring30 } from "./expiring-30";
import { render as renderExpiring14 } from "./expiring-14";
import { render as renderExpiring7 } from "./expiring-7";
import { render as renderExpiredToday } from "./expired-today";
import { render as renderExpiredRecurring } from "./expired-recurring";
import { render as renderPendingAdminAlert } from "./pending-admin-alert";

/**
 * The reminder_type values we actually template. `manual` is a
 * discriminator on `triggered_by`, NOT a separate template — manual
 * sends pick one of these specific types.
 */
export const TEACHER_TEMPLATE_TYPES = [
  "missing_required",
  "rejected_replace",
  "expiring_90",
  "expiring_60",
  "expiring_30",
  "expiring_14",
  "expiring_7",
  "expired_today",
  "expired_recurring",
] as const;

export const ADMIN_TEMPLATE_TYPES = ["pending_admin_alert"] as const;

export type TeacherTemplateType = (typeof TEACHER_TEMPLATE_TYPES)[number];
export type AdminTemplateType = (typeof ADMIN_TEMPLATE_TYPES)[number];
export type TemplateType = TeacherTemplateType | AdminTemplateType;

/**
 * Render a teacher-facing template. The context must match the template's
 * shape — the dispatcher knows which to use because it builds the
 * context next to the candidate query.
 */
export function renderTeacherTemplate(
  type: TeacherTemplateType,
  ctx: BaseCtx | ExpiryCtx | ExpiredCtx | ExpiredRecurringCtx
): RenderedEmail {
  switch (type) {
    case "missing_required":
      return renderMissingRequired(ctx as BaseCtx);
    case "rejected_replace":
      return renderRejectedReplace(ctx as BaseCtx);
    case "expiring_90":
      return renderExpiring90(ctx as ExpiryCtx);
    case "expiring_60":
      return renderExpiring60(ctx as ExpiryCtx);
    case "expiring_30":
      return renderExpiring30(ctx as ExpiryCtx);
    case "expiring_14":
      return renderExpiring14(ctx as ExpiryCtx);
    case "expiring_7":
      return renderExpiring7(ctx as ExpiryCtx);
    case "expired_today":
      return renderExpiredToday(ctx as ExpiredCtx);
    case "expired_recurring":
      return renderExpiredRecurring(ctx as ExpiredRecurringCtx);
  }
}

export function renderAdminTemplate(
  type: AdminTemplateType,
  ctx: AdminAlertCtx
): RenderedEmail {
  switch (type) {
    case "pending_admin_alert":
      return renderPendingAdminAlert(ctx);
  }
}

/**
 * Render every template against the sample context. Used by
 * `/admin/reminders/preview` and asserted in tests so a new template
 * can't ship without a preview.
 */
export interface TemplatePreview {
  type: TemplateType;
  audience: "teacher" | "admin";
  rendered: RenderedEmail;
}

export function renderAllPreviews(): TemplatePreview[] {
  const baseCtx: BaseCtx = {
    teacher: SAMPLE_TEACHER,
    documentType: SAMPLE_DOC_TYPE,
    settings: SAMPLE_SETTINGS,
  };
  const expiryCtx: ExpiryCtx = { ...baseCtx, expiresOn: "2026-09-01" };
  const expiredCtx: ExpiredCtx = { ...baseCtx, expiredOn: "2026-06-10" };
  const expiredRecurringCtx: ExpiredRecurringCtx = {
    ...baseCtx,
    expiredOn: "2026-05-27",
    daysOverdue: 14,
  };
  const adminAlertCtx: AdminAlertCtx = {
    admin: { firstName: "Sam" },
    teacherDisplay: "Pat",
    documentType: SAMPLE_DOC_TYPE,
    daysPending: 5,
    settings: SAMPLE_SETTINGS,
  };

  const out: TemplatePreview[] = [];
  for (const t of TEACHER_TEMPLATE_TYPES) {
    let ctx: BaseCtx | ExpiryCtx | ExpiredCtx | ExpiredRecurringCtx = baseCtx;
    if (t === "expiring_90" || t === "expiring_60" || t === "expiring_30" || t === "expiring_14" || t === "expiring_7") {
      ctx = expiryCtx;
    } else if (t === "expired_today") {
      ctx = expiredCtx;
    } else if (t === "expired_recurring") {
      ctx = expiredRecurringCtx;
    }
    out.push({
      type: t,
      audience: "teacher",
      rendered: renderTeacherTemplate(t, ctx),
    });
  }
  for (const t of ADMIN_TEMPLATE_TYPES) {
    out.push({
      type: t,
      audience: "admin",
      rendered: renderAdminTemplate(t, adminAlertCtx),
    });
  }
  return out;
}
