import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/guards";
import { AdminNav } from "@/components/admin/nav";
import { db } from "@/lib/db/client";
import { documentTypes, users } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const REMINDER_TYPES = [
  { value: "missing_required", label: "Missing required document" },
  { value: "rejected_replace", label: "Rejected — needs replacement" },
  { value: "expiring_90", label: "Expiring in 90 days" },
  { value: "expiring_60", label: "Expiring in 60 days" },
  { value: "expiring_30", label: "Expiring in 30 days" },
  { value: "expiring_14", label: "Expiring in 14 days" },
  { value: "expiring_7", label: "Expiring in 7 days" },
  { value: "expired_today", label: "Expired today" },
  { value: "expired_recurring", label: "Still expired — recurring" },
] as const;

export default async function AdminRemindersManualPage({
  searchParams,
}: {
  searchParams: Promise<{
    teacherId?: string;
    reminderType?: string;
    sent?: string;
    error?: string;
    disposition?: string;
  }>;
}) {
  const user = await requireAdmin();
  const params = await searchParams;

  const [teachers, docTypes] = await Promise.all([
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
  ]);

  /**
   * Server-action send. Bridges to the same POST handler logic — we
   * call the route's underlying function-equivalents directly rather
   * than going over HTTP from the same process.
   */
  async function send(formData: FormData) {
    "use server";
    const actor = await requireAdmin();
    const teacherId = String(formData.get("teacherId") ?? "").trim();
    const reminderType = String(formData.get("reminderType") ?? "").trim();
    const teacherDocumentId =
      String(formData.get("teacherDocumentId") ?? "").trim() || undefined;
    const documentTypeId =
      String(formData.get("documentTypeId") ?? "").trim() || undefined;

    // Validate teacherId shape — must be a UUID.
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        teacherId
      )
    ) {
      redirect("/admin/reminders/manual?error=Invalid+teacher");
    }

    // Call the manual route's POST handler — internal call, no HTTP.
    // This keeps the audit log + send pipeline identical to the API
    // path. We bypass auth because we re-checked `requireAdmin()`
    // above; the route's own auth check will pass again because the
    // server action shares the session.
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
    void actor; // used by requireAdmin's redirect-on-miss side effect
    let body: { disposition?: string; error?: string };
    try {
      body = await res.json();
    } catch {
      body = { error: "Unknown error" };
    }
    if (res.ok) {
      redirect(
        `/admin/reminders/manual?sent=1&disposition=${encodeURIComponent(
          body.disposition ?? "sent"
        )}`
      );
    }
    redirect(
      `/admin/reminders/manual?error=${encodeURIComponent(
        body.error ?? `HTTP ${res.status}`
      )}`
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
          Pick a teacher and a reminder type. The system looks up the
          teacher&apos;s email from their account — you can&apos;t change the
          recipient. Manual sends bypass the daily cap.
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

        <form action={send} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Teacher
            </label>
            <select
              name="teacherId"
              required
              defaultValue={params.teacherId ?? ""}
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="">— Choose a teacher —</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.email})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Reminder type
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
              Document type (required for &quot;Missing required document&quot;)
            </label>
            <select
              name="documentTypeId"
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="">— None —</option>
              {docTypes.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              Only needed for the &quot;Missing&quot; reminder.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Teacher document ID (required for rejected / expiring / expired
              reminders)
            </label>
            <input
              name="teacherDocumentId"
              type="text"
              placeholder="uuid of a specific teacher_documents row"
              className="w-full rounded-md border border-slate-300 px-3 py-2"
            />
            <p className="text-xs text-slate-500 mt-1">
              Copy from the teacher detail page. We don&apos;t auto-pick because
              there may be multiple historical rows.
            </p>
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
      </main>
    </>
  );
}
