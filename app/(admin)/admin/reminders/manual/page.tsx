import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, isNull } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/guards";
import { AdminNav } from "@/components/admin/nav";
import { db } from "@/lib/db/client";
import { documentTypes, teacherDocuments, users } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const REMINDER_TYPES = [
  { value: "missing_required", label: "Missing required document", scope: "docType" },
  { value: "rejected_replace", label: "Rejected — needs replacement", scope: "document" },
  { value: "expiring_90", label: "Expiring in 90 days", scope: "document" },
  { value: "expiring_60", label: "Expiring in 60 days", scope: "document" },
  { value: "expiring_30", label: "Expiring in 30 days", scope: "document" },
  { value: "expiring_14", label: "Expiring in 14 days", scope: "document" },
  { value: "expiring_7", label: "Expiring in 7 days", scope: "document" },
  { value: "expired_today", label: "Expired today", scope: "document" },
  { value: "expired_recurring", label: "Still expired — recurring", scope: "document" },
] as const;

function isUuid(value: string | undefined): value is string {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value ?? ""
  );
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return "no expiry";
  return new Date(d).toLocaleDateString();
}

export default async function AdminRemindersManualPage({
  searchParams,
}: {
  searchParams: Promise<{
    teacherId?: string;
    reminderType?: string;
    teacherDocumentId?: string;
    documentTypeId?: string;
    sent?: string;
    error?: string;
    disposition?: string;
  }>;
}) {
  const user = await requireAdmin();
  const params = await searchParams;
  const selectedTeacherId = isUuid(params.teacherId) ? params.teacherId : undefined;

  const [teachers, docTypes, selectedTeacherRows, selectedDocs] = await Promise.all([
    db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.role, "teacher"))
      .orderBy(users.name),
    db
      .select({ id: documentTypes.id, name: documentTypes.name })
      .from(documentTypes)
      .where(eq(documentTypes.active, true))
      .orderBy(documentTypes.name),
    selectedTeacherId
      ? db
          .select({ id: users.id, email: users.email, name: users.name })
          .from(users)
          .where(and(eq(users.id, selectedTeacherId), eq(users.role, "teacher")))
          .limit(1)
      : Promise.resolve([]),
    selectedTeacherId
      ? db
          .select({
            id: teacherDocuments.id,
            status: teacherDocuments.status,
            originalFilename: teacherDocuments.originalFilename,
            expiresAt: teacherDocuments.expiresAt,
            uploadedAt: teacherDocuments.uploadedAt,
            documentTypeName: documentTypes.name,
          })
          .from(teacherDocuments)
          .innerJoin(documentTypes, eq(documentTypes.id, teacherDocuments.documentTypeId))
          .where(
            and(
              eq(teacherDocuments.userId, selectedTeacherId),
              isNull(teacherDocuments.supersededBy)
            )
          )
          .orderBy(desc(teacherDocuments.uploadedAt))
      : Promise.resolve([]),
  ]);
  const selectedTeacher = selectedTeacherRows[0];

  async function send(formData: FormData) {
    "use server";
    const actor = await requireAdmin();
    const teacherId = String(formData.get("teacherId") ?? "").trim();
    const reminderType = String(formData.get("reminderType") ?? "").trim();
    const teacherDocumentId =
      String(formData.get("teacherDocumentId") ?? "").trim() || undefined;
    const documentTypeId =
      String(formData.get("documentTypeId") ?? "").trim() || undefined;

    if (!isUuid(teacherId)) {
      redirect("/admin/reminders/manual?error=Choose+a+teacher+first");
    }

    const { POST } = await import("@/app/api/admin/reminders/manual/route");
    const req = new Request("http://internal/api/admin/reminders/manual", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        teacherId,
        reminderType,
        ...(teacherDocumentId ? { teacherDocumentId } : {}),
        ...(documentTypeId ? { documentTypeId } : {}),
      }),
    });
    const res = await POST(req);
    void actor;
    let body: { disposition?: string; error?: string };
    try {
      body = await res.json();
    } catch {
      body = { error: "Unknown error" };
    }
    if (res.ok) {
      redirect(
        `/admin/reminders/manual?teacherId=${encodeURIComponent(
          teacherId
        )}&sent=1&disposition=${encodeURIComponent(body.disposition ?? "sent")}`
      );
    }
    redirect(
      `/admin/reminders/manual?teacherId=${encodeURIComponent(
        teacherId
      )}&error=${encodeURIComponent(body.error ?? `HTTP ${res.status}`)}`
    );
  }

  return (
    <>
      <AdminNav email={user.email} active="reminders" />
      <main className="max-w-3xl mx-auto px-6 py-8">
        <Link
          href="/admin/reminders"
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← Back to reminders
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900 mt-3 mb-2">
          Send a reminder manually
        </h1>
        <p className="text-slate-600 mb-6">
          Choose the teacher first. Then pick the reminder and the exact document
          from that teacher&apos;s current uploads. No copying database IDs.
        </p>

        {params.sent ? (
          <div className="mb-4 rounded-md bg-green-50 border border-green-200 px-4 py-2 text-sm text-green-800">
            Result: {params.disposition ?? "sent"}.
          </div>
        ) : null}
        {params.error ? (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-800">
            {params.error}
          </div>
        ) : null}

        <form method="get" className="mb-6 rounded-lg border border-slate-200 p-5">
          <label className="block text-sm font-medium text-slate-700 mb-1">
            1. Choose teacher
          </label>
          <div className="flex flex-col sm:flex-row gap-3">
            <select
              name="teacherId"
              required
              defaultValue={selectedTeacherId ?? ""}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="">— Choose a teacher —</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.email})
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-md border border-slate-300 px-4 py-2 font-medium text-slate-700 hover:bg-slate-50"
            >
              Load teacher
            </button>
          </div>
        </form>

        {selectedTeacher ? (
          <form action={send} className="space-y-5">
            <input type="hidden" name="teacherId" value={selectedTeacher.id} />

            <section className="rounded-lg border border-slate-200 p-5 bg-slate-50">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Recipient
              </div>
              <div className="mt-1 font-medium text-slate-900">{selectedTeacher.name}</div>
              <div className="text-sm text-slate-600">{selectedTeacher.email}</div>
            </section>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                2. Reminder type
              </label>
              <select
                name="reminderType"
                required
                defaultValue={params.reminderType ?? ""}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              >
                <option value="">— Choose a reminder type —</option>
                {REMINDER_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                3a. Document for rejected, expiring, or expired reminders
              </label>
              <select
                name="teacherDocumentId"
                defaultValue={params.teacherDocumentId ?? ""}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              >
                <option value="">— Choose one of {selectedTeacher.name}&apos;s documents —</option>
                {selectedDocs.length === 0 ? (
                  <option value="" disabled>
                    No current documents for this teacher
                  </option>
                ) : null}
                {selectedDocs.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.documentTypeName} · {d.status} · expires {formatDate(d.expiresAt)} · {d.originalFilename}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500 mt-1">
                Use this for every reminder except “Missing required document.”
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                3b. Missing document type
              </label>
              <select
                name="documentTypeId"
                defaultValue={params.documentTypeId ?? ""}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              >
                <option value="">— Choose the missing document type —</option>
                {docTypes.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500 mt-1">
                Only needed when the reminder type is “Missing required document.”
              </p>
            </div>

            <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-900">
              Manual sends bypass the daily cap. The recipient email still comes
              from the teacher account, not from this form.
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                className="rounded-md bg-blue-600 px-5 py-2 text-white font-medium hover:bg-blue-700"
              >
                Send reminder
              </button>
            </div>
          </form>
        ) : (
          <section className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-slate-600">
            Choose a teacher to load their current documents and send options.
          </section>
        )}
      </main>
    </>
  );
}
