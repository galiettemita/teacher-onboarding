import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guards";
import { AdminNav } from "@/components/admin/nav";
import {
  NOTIFICATION_LOG_DEFAULT_PAGE_SIZE,
  NOTIFICATION_LOG_MAX_PAGE_SIZE,
  listNotificationLogs,
  type NotificationLogFilters,
} from "@/lib/db/queries/notification-logs";

export const dynamic = "force-dynamic";

interface SearchParams {
  teacherId?: string;
  status?: string;
  reminderType?: string;
  since?: string;
  until?: string;
  page?: string;
  pageSize?: string;
}

function toInt(raw: string | undefined, def: number, min: number, max: number) {
  if (!raw) return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}
function nonEmpty(raw: string | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  return t.length > 0 ? t : null;
}
function toDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

const STATUSES = ["queued", "sent", "failed", "skipped"] as const;
const TYPES = [
  "missing_required",
  "rejected_replace",
  "expiring_90",
  "expiring_60",
  "expiring_30",
  "expiring_14",
  "expiring_7",
  "expired_today",
  "expired_recurring",
  "pending_admin_alert",
  "manual",
] as const;

function fmt(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().replace("T", " ").slice(0, 19) + "Z";
}

export default async function AdminRemindersLogsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireAdmin();
  const params = await searchParams;

  const page = toInt(params.page, 1, 1, 1_000_000);
  const pageSize = toInt(
    params.pageSize,
    NOTIFICATION_LOG_DEFAULT_PAGE_SIZE,
    1,
    NOTIFICATION_LOG_MAX_PAGE_SIZE
  );

  const filters: NotificationLogFilters = {
    teacherId: nonEmpty(params.teacherId),
    status: nonEmpty(params.status) as NotificationLogFilters["status"],
    reminderType: nonEmpty(params.reminderType),
    since: toDate(params.since),
    until: toDate(params.until),
  };

  const result = await listNotificationLogs(
    { role: user.role },
    filters,
    { page, pageSize }
  );

  function pageHref(p: number): string {
    const qp = new URLSearchParams();
    if (filters.teacherId) qp.set("teacherId", filters.teacherId);
    if (filters.status) qp.set("status", filters.status);
    if (filters.reminderType) qp.set("reminderType", filters.reminderType);
    if (params.since) qp.set("since", params.since);
    if (params.until) qp.set("until", params.until);
    qp.set("page", String(p));
    qp.set("pageSize", String(pageSize));
    return `/admin/reminders/logs?${qp.toString()}`;
  }

  return (
    <>
      <AdminNav email={user.email} active="reminders" />
      <main className="max-w-6xl mx-auto px-6 py-8">
        <Link
          href="/admin/reminders"
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← Back to reminders
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900 mt-3 mb-6">
          Reminder send log
        </h1>

        <form
          method="get"
          className="grid grid-cols-1 sm:grid-cols-5 gap-3 mb-6 rounded-lg border border-slate-200 p-4"
        >
          <div>
            <label className="block text-xs text-slate-500 mb-1">Status</label>
            <select
              name="status"
              defaultValue={params.status ?? ""}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">Any</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Type</label>
            <select
              name="reminderType"
              defaultValue={params.reminderType ?? ""}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              <option value="">Any</option>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">
              Teacher ID
            </label>
            <input
              name="teacherId"
              defaultValue={params.teacherId ?? ""}
              placeholder="uuid"
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">
              Since (ISO)
            </label>
            <input
              name="since"
              defaultValue={params.since ?? ""}
              placeholder="2026-01-01"
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              className="w-full rounded-md bg-slate-900 px-3 py-1.5 text-white text-sm hover:bg-slate-700"
            >
              Filter
            </button>
          </div>
        </form>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-600">
              <tr>
                <th className="py-2 px-3 font-medium">Created</th>
                <th className="py-2 px-3 font-medium">Teacher</th>
                <th className="py-2 px-3 font-medium">Type</th>
                <th className="py-2 px-3 font-medium">Status</th>
                <th className="py-2 px-3 font-medium">Subject</th>
                <th className="py-2 px-3 font-medium">Reason</th>
                <th className="py-2 px-3 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.length === 0 ? (
                <tr>
                  <td className="py-6 px-3 text-center text-slate-500" colSpan={7}>
                    No log rows match these filters.
                  </td>
                </tr>
              ) : (
                result.rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="py-2 px-3 text-slate-700 whitespace-nowrap">
                      {fmt(r.createdAt)}
                    </td>
                    <td className="py-2 px-3 text-slate-700">
                      {r.teacherEmail ?? r.teacherId.slice(0, 8)}
                    </td>
                    <td className="py-2 px-3 text-slate-700">{r.reminderType}</td>
                    <td className="py-2 px-3">
                      <span
                        className={
                          r.status === "sent"
                            ? "text-green-700"
                            : r.status === "failed"
                            ? "text-red-700"
                            : r.status === "skipped"
                            ? "text-slate-500"
                            : "text-amber-700"
                        }
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-700 max-w-md truncate">
                      {r.subject}
                    </td>
                    <td className="py-2 px-3 text-slate-500 text-xs">
                      {r.failedReason ?? r.skippedReason ?? "—"}
                    </td>
                    <td className="py-2 px-3 text-slate-500 text-xs">
                      {r.triggeredBy}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <nav className="flex items-center justify-between mt-4 text-sm">
          <span className="text-slate-500">
            Page {result.page} of {result.totalPages} ({result.total} rows)
          </span>
          <div className="flex gap-2">
            {result.page > 1 ? (
              <Link
                href={pageHref(result.page - 1)}
                className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50"
              >
                ← Prev
              </Link>
            ) : null}
            {result.page < result.totalPages ? (
              <Link
                href={pageHref(result.page + 1)}
                className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50"
              >
                Next →
              </Link>
            ) : null}
          </div>
        </nav>
      </main>
    </>
  );
}
