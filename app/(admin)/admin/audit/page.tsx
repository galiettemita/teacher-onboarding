import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guards";
import { AdminNav } from "@/components/admin/nav";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  listAuditLog,
  listDistinctActions,
} from "@/lib/audit/queries";

export const dynamic = "force-dynamic";

interface SearchParams {
  actorId?: string;
  action?: string;
  targetType?: string;
  since?: string;
  until?: string;
  page?: string;
  pageSize?: string;
}

function toInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function toDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

function nonEmpty(raw: string | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  return t.length > 0 ? t : null;
}

function fmt(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19) + "Z";
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requireAdmin();
  const params = await searchParams;

  const page = toInt(params.page, 1, 1, 1_000_000);
  const pageSize = toInt(params.pageSize, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);

  const filters = {
    actorId: nonEmpty(params.actorId),
    action: nonEmpty(params.action),
    targetType: nonEmpty(params.targetType),
    since: toDate(params.since),
    until: toDate(params.until),
  };

  const [result, actions] = await Promise.all([
    listAuditLog(filters, { page, pageSize }),
    listDistinctActions(),
  ]);

  function pageHref(p: number): string {
    const qp = new URLSearchParams();
    if (filters.actorId) qp.set("actorId", filters.actorId);
    if (filters.action) qp.set("action", filters.action);
    if (filters.targetType) qp.set("targetType", filters.targetType);
    if (params.since) qp.set("since", params.since);
    if (params.until) qp.set("until", params.until);
    qp.set("page", String(p));
    qp.set("pageSize", String(pageSize));
    return `/admin/audit?${qp.toString()}`;
  }

  return (
    <>
      <AdminNav email={user.email} active="audit" />
      <main className="flex-1 p-6 max-w-6xl mx-auto w-full">
        <h1 className="text-2xl font-semibold text-slate-900 mb-2">Audit log</h1>
        <p className="text-sm text-slate-600 mb-6">
          Every admin mutation, file download, and report export. Showing
          page {result.page} of {result.totalPages} ({result.total.toLocaleString()} rows).
        </p>

        <form
          method="GET"
          action="/admin/audit"
          className="mb-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3 items-end"
        >
          <label className="text-xs text-slate-600 flex flex-col gap-1">
            Actor ID
            <input
              type="text"
              name="actorId"
              defaultValue={filters.actorId ?? ""}
              placeholder="uuid"
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs text-slate-600 flex flex-col gap-1">
            Action
            <select
              name="action"
              defaultValue={filters.action ?? ""}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="">Any</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-600 flex flex-col gap-1">
            Target type
            <input
              type="text"
              name="targetType"
              defaultValue={filters.targetType ?? ""}
              placeholder="document, user, …"
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs text-slate-600 flex flex-col gap-1">
            Since
            <input
              type="datetime-local"
              name="since"
              defaultValue={params.since ?? ""}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs text-slate-600 flex flex-col gap-1">
            Until
            <input
              type="datetime-local"
              name="until"
              defaultValue={params.until ?? ""}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <div className="sm:col-span-2 md:col-span-5 flex gap-2">
            <button
              type="submit"
              className="rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2"
            >
              Apply filters
            </button>
            <Link
              href="/admin/audit"
              className="rounded-md border border-slate-300 text-slate-700 text-sm px-4 py-2"
            >
              Reset
            </Link>
          </div>
        </form>

        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-3 py-2">When</th>
                <th className="text-left px-3 py-2">Actor</th>
                <th className="text-left px-3 py-2">Action</th>
                <th className="text-left px-3 py-2">Target</th>
                <th className="text-left px-3 py-2">Metadata</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-slate-500 text-center">
                    No rows match these filters.
                  </td>
                </tr>
              ) : (
                result.rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-slate-700">
                      {fmt(r.createdAt)}
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {r.actorEmail ?? <span className="italic text-slate-400">system</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-800">{r.action}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-600">
                      {r.targetType ?? "—"}
                      {r.targetId ? <> · {r.targetId.slice(0, 8)}</> : null}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-500 break-all max-w-md">
                      {JSON.stringify(r.metadata)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <nav className="mt-4 flex items-center justify-between text-sm">
          <span className="text-slate-600">
            Page {result.page} / {result.totalPages}
          </span>
          <div className="flex gap-2">
            {result.page > 1 ? (
              <Link
                href={pageHref(result.page - 1)}
                className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-100"
              >
                ← Previous
              </Link>
            ) : null}
            {result.page < result.totalPages ? (
              <Link
                href={pageHref(result.page + 1)}
                className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-100"
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
