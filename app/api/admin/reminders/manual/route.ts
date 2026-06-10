import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import {
  documentTypes,
  teacherDocuments,
  users,
} from "@/lib/db/schema";
import { auditLog } from "@/lib/audit/log";
import { sendManual } from "@/lib/reminders/dispatcher";
import {
  keyExpiring,
  keyExpiredRecurring,
  keyExpiredToday,
  keyMissingRequired,
  keyRejectedReplace,
  toYMD,
} from "@/lib/reminders/keys";
import { type ExpiringMilestoneDays } from "@/lib/reminders/types";
import type { Candidate } from "@/lib/reminders/candidates";
import { daysOverdue } from "@/lib/reminders/milestones";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/reminders/manual
 *
 * Admin-triggered send. The caller supplies a teacherId (UUID) and a
 * reminderType; optionally a documentTypeId / teacherDocumentId when
 * the type needs them. We:
 *
 *  1. Look up the teacher's email server-side from `users.email`. We
 *     NEVER accept an email from the body — that would let a compromised
 *     admin session exfiltrate doc-type info to an attacker mailbox.
 *  2. Look up doc-type name and current doc as needed.
 *  3. Build a Candidate and call sendManual() — which writes through
 *     the same UNIQUE-index reservation as the cron path.
 *  4. Write an audit row (reminders.manual_send).
 *
 * Body:
 *   {
 *     teacherId: "uuid",
 *     reminderType: "missing_required" | "rejected_replace" |
 *                   "expiring_90" | ... | "expired_recurring",
 *     teacherDocumentId?: "uuid",  // required for doc-scoped types
 *     documentTypeId?: "uuid",     // required for missing_required
 *   }
 */

const MANUAL_TYPES = [
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

const Body = z
  .object({
    teacherId: z.string().uuid(),
    reminderType: z.enum(MANUAL_TYPES),
    teacherDocumentId: z.string().uuid().optional(),
    documentTypeId: z.string().uuid().optional(),
  })
  .strict();

function firstNameOf(name: string | null | undefined): string {
  const t = (name ?? "").trim().split(/\s+/)[0] ?? "";
  return t.length > 0 ? t : "there";
}

function isExpiringType(
  t: (typeof MANUAL_TYPES)[number]
): t is "expiring_90" | "expiring_60" | "expiring_30" | "expiring_14" | "expiring_7" {
  return (
    t === "expiring_90" ||
    t === "expiring_60" ||
    t === "expiring_30" ||
    t === "expiring_14" ||
    t === "expiring_7"
  );
}

function expiringDaysOf(t: (typeof MANUAL_TYPES)[number]): ExpiringMilestoneDays {
  switch (t) {
    case "expiring_90":
      return 90;
    case "expiring_60":
      return 60;
    case "expiring_30":
      return 30;
    case "expiring_14":
      return 14;
    case "expiring_7":
      return 7;
    default:
      throw new Error("not an expiring type");
  }
}

async function buildCandidateForManual(
  input: z.infer<typeof Body>
): Promise<{ candidate: Candidate } | { error: string; status: number }> {
  // Look up the teacher, asserting they're actually a teacher.
  const teacherRows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, input.teacherId))
    .limit(1);
  const teacher = teacherRows[0];
  if (!teacher) return { error: "Teacher not found", status: 404 };
  if (teacher.role !== "teacher") {
    return { error: "Target user is not a teacher", status: 400 };
  }
  if (!teacher.email) return { error: "Teacher has no email on file", status: 400 };

  // Doc-scoped types: look up the teacher_document + its document_type.
  if (input.reminderType !== "missing_required") {
    if (!input.teacherDocumentId) {
      return { error: "teacherDocumentId is required for this reminder type", status: 400 };
    }
    const docRows = await db
      .select({
        id: teacherDocuments.id,
        userId: teacherDocuments.userId,
        documentTypeId: teacherDocuments.documentTypeId,
        documentTypeName: documentTypes.name,
        status: teacherDocuments.status,
        expiresAt: teacherDocuments.expiresAt,
        reviewedAt: teacherDocuments.reviewedAt,
        supersededBy: teacherDocuments.supersededBy,
      })
      .from(teacherDocuments)
      .innerJoin(
        documentTypes,
        eq(documentTypes.id, teacherDocuments.documentTypeId)
      )
      .where(eq(teacherDocuments.id, input.teacherDocumentId))
      .limit(1);
    const doc = docRows[0];
    if (!doc) return { error: "Document not found", status: 404 };
    if (doc.userId !== teacher.id) {
      return { error: "Document does not belong to this teacher", status: 400 };
    }

    const now = new Date();

    if (input.reminderType === "rejected_replace") {
      const bucket = toYMD(now);
      return {
        candidate: {
          userId: teacher.id,
          recipientEmail: teacher.email,
          teacherFirstName: firstNameOf(teacher.name),
          teacherDocumentId: doc.id,
          documentTypeId: doc.documentTypeId,
          documentTypeName: doc.documentTypeName,
          reminderType: "rejected_replace",
          milestoneKey: keyRejectedReplace(doc.id, bucket),
          payload: { kind: "rejected_replace" },
        },
      };
    }

    if (input.reminderType === "expired_today") {
      const when = doc.expiresAt ?? now;
      return {
        candidate: {
          userId: teacher.id,
          recipientEmail: teacher.email,
          teacherFirstName: firstNameOf(teacher.name),
          teacherDocumentId: doc.id,
          documentTypeId: doc.documentTypeId,
          documentTypeName: doc.documentTypeName,
          reminderType: "expired_today",
          milestoneKey: keyExpiredToday(doc.id),
          payload: { kind: "expired_today", expiredOn: toYMD(when) },
        },
      };
    }

    if (input.reminderType === "expired_recurring") {
      if (!doc.expiresAt) {
        return { error: "Document has no expiry date", status: 400 };
      }
      return {
        candidate: {
          userId: teacher.id,
          recipientEmail: teacher.email,
          teacherFirstName: firstNameOf(teacher.name),
          teacherDocumentId: doc.id,
          documentTypeId: doc.documentTypeId,
          documentTypeName: doc.documentTypeName,
          reminderType: "expired_recurring",
          milestoneKey: keyExpiredRecurring(doc.id, now),
          payload: {
            kind: "expired_recurring",
            expiredOn: toYMD(doc.expiresAt),
            daysOverdue: daysOverdue(doc.expiresAt, now),
          },
        },
      };
    }

    if (isExpiringType(input.reminderType)) {
      if (!doc.expiresAt) {
        return { error: "Document has no expiry date", status: 400 };
      }
      const days = expiringDaysOf(input.reminderType);
      return {
        candidate: {
          userId: teacher.id,
          recipientEmail: teacher.email,
          teacherFirstName: firstNameOf(teacher.name),
          teacherDocumentId: doc.id,
          documentTypeId: doc.documentTypeId,
          documentTypeName: doc.documentTypeName,
          reminderType: input.reminderType,
          milestoneKey: keyExpiring(days, doc.id),
          payload: {
            kind: "expiring",
            days,
            expiresOn: toYMD(doc.expiresAt),
          },
        },
      };
    }
  }

  // missing_required: needs documentTypeId
  if (!input.documentTypeId) {
    return { error: "documentTypeId is required for missing_required", status: 400 };
  }
  const dtRows = await db
    .select({
      id: documentTypes.id,
      name: documentTypes.name,
      active: documentTypes.active,
    })
    .from(documentTypes)
    .where(eq(documentTypes.id, input.documentTypeId))
    .limit(1);
  const dt = dtRows[0];
  if (!dt) return { error: "Document type not found", status: 404 };
  if (!dt.active) {
    return { error: "Document type is deactivated", status: 400 };
  }

  // Confirm the teacher truly is missing this doc.
  const existing = await db
    .select({ id: teacherDocuments.id })
    .from(teacherDocuments)
    .where(
      and(
        eq(teacherDocuments.userId, teacher.id),
        eq(teacherDocuments.documentTypeId, dt.id),
        isNull(teacherDocuments.supersededBy)
      )
    )
    .limit(1);
  if (existing.length > 0) {
    return {
      error: "Teacher already has a current document for this type",
      status: 400,
    };
  }

  return {
    candidate: {
      userId: teacher.id,
      recipientEmail: teacher.email,
      teacherFirstName: firstNameOf(teacher.name),
      teacherDocumentId: null,
      documentTypeId: dt.id,
      documentTypeName: dt.name,
      reminderType: "missing_required",
      milestoneKey: keyMissingRequired(teacher.id, dt.id, new Date()),
      payload: { kind: "missing_required" },
    },
  };
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      {
        error: "Invalid body",
        details: err instanceof Error ? err.message : "parse error",
      },
      { status: 400 }
    );
  }

  const built = await buildCandidateForManual(parsed);
  if ("error" in built) {
    return NextResponse.json({ error: built.error }, { status: built.status });
  }

  const result = await sendManual({
    candidate: built.candidate,
    actorId: session.user.id,
  });

  await auditLog({
    actorId: session.user.id,
    action: "reminders.manual_send",
    targetType: "user",
    targetId: built.candidate.userId,
    metadata: {
      reminderType: built.candidate.reminderType,
      teacherDocumentId: built.candidate.teacherDocumentId,
      documentTypeId: built.candidate.documentTypeId,
      disposition: result.disposition,
    },
  });

  return NextResponse.json(
    {
      ok: result.disposition === "sent",
      disposition: result.disposition,
      ...(result.error ? { error: result.error } : {}),
    },
    {
      status:
        result.disposition === "sent"
          ? 200
          : result.disposition === "skipped_duplicate"
          ? 200
          : 502,
    }
  );
}
