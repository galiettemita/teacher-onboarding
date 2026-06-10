/**
 * Reminder dispatcher — the single entry point for sending reminders.
 *
 * §8 rule 15: "All sends — automated and manual — go through
 * lib/reminders/dispatch.ts which enforces idempotency + daily cap +
 * logging. No ad-hoc sendEmail() calls from feature code."
 *
 * runOnce(now): main cron path. Loads settings, finds all candidates,
 *   groups by teacher, picks one (or all, when daily-cap is off) per
 *   teacher, tries to reserve via the UNIQUE-index insert, sends, and
 *   records the outcome. Returns counts.
 *
 * sendManual(opts): admin-triggered path. Bypasses the daily cap but
 *   still goes through the same reservation + logging path.
 */

import {
  type Candidate,
  findAllCandidates,
} from "./candidates";
import {
  getReminderSettings,
  type ReminderSettings,
} from "@/lib/db/queries/reminder-settings";
import {
  recordFailed,
  recordSent,
  recordSkip,
  teacherHadSentToday,
  tryReserveSlot,
} from "@/lib/db/queries/notification-logs";
import { groupByTeacher, sortByPriority } from "./priority";
import { type DispatchCounts, emptyCounts } from "./types";
import { sendEmail, type EmailMessage, type SendResult } from "@/lib/email/send";
import {
  renderAdminTemplate,
  renderTeacherTemplate,
  type AdminTemplateType,
  type TeacherTemplateType,
} from "@/lib/email/templates";
import type {
  AdminAlertCtx,
  BaseCtx,
  ExpiredCtx,
  ExpiredRecurringCtx,
  ExpiryCtx,
  RenderedEmail,
} from "@/lib/email/templates/base";

/**
 * Render the right template for a candidate. The candidate carries a
 * discriminated `payload` that tells us which context type to build.
 *
 * The settings (school name, portal URL) come from the settings row,
 * NOT the candidate, so a single bad row can't divert links.
 */
export function renderForCandidate(
  c: Candidate,
  settings: ReminderSettings
): RenderedEmail {
  const settingsCtx = {
    schoolName: settings.senderName,
    portalUrl: settings.portalUrl,
  };
  const baseCtx: BaseCtx = {
    teacher: { firstName: c.teacherFirstName },
    documentType: { name: c.documentTypeName },
    settings: settingsCtx,
  };

  switch (c.payload.kind) {
    case "missing_required":
      return renderTeacherTemplate("missing_required", baseCtx);
    case "rejected_replace":
      return renderTeacherTemplate("rejected_replace", baseCtx);
    case "expiring": {
      const ctx: ExpiryCtx = { ...baseCtx, expiresOn: c.payload.expiresOn };
      const type = (`expiring_${c.payload.days}` as TeacherTemplateType);
      return renderTeacherTemplate(type, ctx);
    }
    case "expired_today": {
      const ctx: ExpiredCtx = { ...baseCtx, expiredOn: c.payload.expiredOn };
      return renderTeacherTemplate("expired_today", ctx);
    }
    case "expired_recurring": {
      const ctx: ExpiredRecurringCtx = {
        ...baseCtx,
        expiredOn: c.payload.expiredOn,
        daysOverdue: c.payload.daysOverdue,
      };
      return renderTeacherTemplate("expired_recurring", ctx);
    }
    case "pending_admin_alert": {
      const ctx: AdminAlertCtx = {
        admin: { firstName: c.teacherFirstName },
        teacherDisplay: c.teacherFirstName,
        documentType: { name: c.documentTypeName },
        daysPending: c.payload.daysPending,
        settings: settingsCtx,
      };
      return renderAdminTemplate(
        "pending_admin_alert" satisfies AdminTemplateType,
        ctx
      );
    }
  }
}

/**
 * Compose an EmailMessage from the rendered template and the
 * candidate's recipient.
 */
function buildMessage(
  rendered: RenderedEmail,
  recipient: string,
  settings: ReminderSettings
): EmailMessage {
  return {
    to: recipient,
    from: { name: settings.senderName, email: settings.senderEmail },
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  };
}

/** Process one candidate. Wraps reserve → send → record. */
async function processCandidate(
  c: Candidate,
  settings: ReminderSettings,
  triggeredBy: "cron" | "admin_manual",
  actorId: string | null
): Promise<"sent" | "skipped_duplicate" | "failed"> {
  const rendered = renderForCandidate(c, settings);

  const reserve = await tryReserveSlot({
    teacherId: c.userId,
    teacherDocumentId: c.teacherDocumentId,
    documentTypeId: c.documentTypeId,
    reminderType: c.reminderType,
    milestoneKey: c.milestoneKey,
    recipientEmail: c.recipientEmail,
    subject: rendered.subject,
    triggeredBy,
    actorId,
  });

  if (!reserve.reserved) {
    return "skipped_duplicate";
  }

  let result: SendResult;
  try {
    result = await sendEmail(buildMessage(rendered, c.recipientEmail, settings));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordFailed(reserve.notificationLogId!, msg);
    return "failed";
  }

  if (result.ok) {
    await recordSent(reserve.notificationLogId!, result.providerId);
    return "sent";
  }
  await recordFailed(reserve.notificationLogId!, result.error ?? "unknown");
  return "failed";
}

async function logSkip(
  c: Candidate,
  rendered: RenderedEmail,
  reason: string,
  triggeredBy: "cron" | "admin_manual",
  actorId: string | null
): Promise<void> {
  await recordSkip({
    teacherId: c.userId,
    teacherDocumentId: c.teacherDocumentId,
    documentTypeId: c.documentTypeId,
    reminderType: c.reminderType,
    recipientEmail: c.recipientEmail,
    subject: rendered.subject,
    skippedReason: reason,
    triggeredBy,
    actorId,
    baseMilestoneKey: c.milestoneKey,
  });
}

/**
 * Main cron entry. Returns counts of every disposition for telemetry +
 * the dashboard.
 */
export async function runOnce(now: Date = new Date()): Promise<DispatchCounts> {
  const counts = emptyCounts();
  const settings = await getReminderSettings();

  // Always gather candidates so the counts are honest; if disabled,
  // we just skip everything and log a "skipped_disabled" row per
  // candidate.
  const candidates = await findAllCandidates({
    now,
    configuredExpiringDays: settings.reminderDaysBeforeExpiration,
    postExpirationIntervalDays: settings.postExpirationIntervalDays,
    missingDocIntervalDays: settings.missingDocReminderIntervalDays,
    rejectedDocIntervalDays: settings.rejectedDocReminderIntervalDays,
    pendingAdminAlertDays: settings.pendingReviewDaysBeforeAdminAlert,
  });
  counts.considered = candidates.length;

  if (!settings.enabled) {
    for (const c of candidates) {
      const rendered = renderForCandidate(c, settings);
      await logSkip(c, rendered, "reminders_disabled", "cron", null);
      counts.skippedDisabled++;
    }
    return counts;
  }

  // Filter out candidates whose recipient_email is empty / missing.
  // (The candidate queries already guard, but defence in depth.)
  const valid: Candidate[] = [];
  for (const c of candidates) {
    if (!c.recipientEmail) {
      const rendered = renderForCandidate(c, settings);
      await logSkip(c, rendered, "no_email_on_file", "cron", null);
      counts.skippedNoEmail++;
      continue;
    }
    valid.push(c);
  }

  // Group by teacher. When daily cap is on, only the first (highest
  // priority) candidate per teacher attempts to send; the rest get a
  // `daily_cap` skip row (still useful in the audit trail).
  const groups = groupByTeacher(valid);

  for (const [teacherId, candList] of groups) {
    const sortedCandList = sortByPriority(candList);
    let teacherAlreadySent = false;
    if (settings.maxOneEmailPerTeacherPerDay) {
      // External "already sent today" check (in case another cron run
      // already sent something to this teacher earlier in the day —
      // e.g. an admin manual send).
      teacherAlreadySent = await teacherHadSentToday(teacherId, now);
    }
    for (const c of sortedCandList) {
      if (settings.maxOneEmailPerTeacherPerDay && teacherAlreadySent) {
        const rendered = renderForCandidate(c, settings);
        await logSkip(c, rendered, "daily_cap", "cron", null);
        counts.skippedDailyCap++;
        continue;
      }
      const r = await processCandidate(c, settings, "cron", null);
      if (r === "sent") {
        counts.sent++;
        teacherAlreadySent = true; // future-iteration cap
      } else if (r === "skipped_duplicate") {
        counts.skippedDuplicate++;
      } else {
        counts.failed++;
        // Failed send still consumes the slot — don't try another
        // reminder for this teacher today; the failure is recorded
        // and the next cron run will retry.
        teacherAlreadySent = settings.maxOneEmailPerTeacherPerDay
          ? true
          : teacherAlreadySent;
      }
    }
  }

  return counts;
}

/**
 * Admin-triggered manual send for a chosen teacher + reminder_type.
 * Bypasses the daily cap (§11.4 rule 3) but still uses the UNIQUE
 * index, so the manual send won't re-fire the same milestone twice.
 *
 * Returns the same disposition vocabulary as the cron path.
 */
export async function sendManual(opts: {
  candidate: Candidate;
  actorId: string;
}): Promise<{ disposition: "sent" | "skipped_duplicate" | "failed"; error?: string }> {
  const settings = await getReminderSettings();
  const rendered = renderForCandidate(opts.candidate, settings);
  const reserve = await tryReserveSlot({
    teacherId: opts.candidate.userId,
    teacherDocumentId: opts.candidate.teacherDocumentId,
    documentTypeId: opts.candidate.documentTypeId,
    reminderType: opts.candidate.reminderType,
    milestoneKey: opts.candidate.milestoneKey,
    recipientEmail: opts.candidate.recipientEmail,
    subject: rendered.subject,
    triggeredBy: "admin_manual",
    actorId: opts.actorId,
  });

  if (!reserve.reserved) return { disposition: "skipped_duplicate" };

  let result: SendResult;
  try {
    result = await sendEmail(
      buildMessage(rendered, opts.candidate.recipientEmail, settings)
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordFailed(reserve.notificationLogId!, msg);
    return { disposition: "failed", error: msg };
  }

  if (result.ok) {
    await recordSent(reserve.notificationLogId!, result.providerId);
    return { disposition: "sent" };
  }
  await recordFailed(reserve.notificationLogId!, result.error ?? "unknown");
  return { disposition: "failed", error: result.error };
}
