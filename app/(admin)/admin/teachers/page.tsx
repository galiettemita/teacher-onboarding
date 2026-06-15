import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guards";
import { AdminNav } from "@/components/admin/nav";
import {
  listAllTeachers,
  type CompletionState,
} from "@/lib/db/queries/admin-teachers";
import { staffStatusLabel } from "@/lib/staff/status";

export const dynamic = "force-dynamic";

function parseCompletionState(raw: string | undefined): CompletionState {
  return raw === "complete" || raw === "incomplete" ? raw : "all";
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleDateString();
}

export default async function TeachersListPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const user = await requireAdmin();
  const params = await searchParams;
  const search = (params.q ?? "").trim();
  const status = parseCompletionState(params.status);

  const rows = await listAllTeachers(
    { role: user.role },
    { search: search || undefined, completionState: status }
  );

  return (
    <>
      <AdminNav email={user.email} active="teachers" />
      <main className="flex-1 p-6 max-w-6xl mx-auto w-full">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold text-slate-900">Teachers</h1>
          <Link
            href="/admin/teachers/new"
            className="rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2"
          >
            Invite teacher
          </Link>
        </div>

        <form method="get" className="bg-white border border-slate-200 rounded-xl p-4 mb-6 flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[220px]">
            <label htmlFor="q" className="block text-sm font-medium text-slate-700 mb-1">
              Search name or email
            </label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={search}
              placeholder="e.g. smith"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="status" className="block text-sm font-medium text-slate-700 mb-1">
              Completion
            </label>
            <select
              id="status"
              name="status"
              defaultValue={status}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All</option>
              <option value="complete">Complete</option>
              <option value="incomplete">Incomplete</option>
            </select>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-md bg-slate-900 text-white text-sm font-medium px-4 py-2 hover:bg-slate-800"
            >
              Apply
            </button>
            <Link
              href="/admin/teachers"
              className="rounded-md border border-slate-300 text-sm font-medium px-4 py-2 hover:bg-slate-100"
            >
              Reset
            </Link>
          </div>
        </form>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Teacher</th>
                <th className="text-left px-4 py-3 font-medium">Staff</th>
                <th className="text-left px-4 py-3 font-medium">Completion</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Last activity</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    No teachers match these filters.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const isComplete = r.completion.pct === 100;
                  return (
                    <tr
                      key={r.user.id}
                      className="border-t border-slate-100 hover:bg-slate-50"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{r.user.name}</div>
                        <div className="text-slate-500">{r.user.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        {r.profile.staffStatus === "new_first_year" ? (
                          <span className="inline-flex items-center rounded-full bg-blue-100 text-blue-800 border border-blue-200 px-2 py-0.5 text-xs font-medium">
                            {staffStatusLabel(r.profile.staffStatus)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-700 border border-slate-200 px-2 py-0.5 text-xs font-medium">
                            {staffStatusLabel(r.profile.staffStatus)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-24 bg-slate-200 rounded-full h-2 overflow-hidden">
                            <div
                              className={`h-full ${
                                isComplete ? "bg-green-500" : "bg-amber-500"
                              }`}
                              style={{ width: `${r.completion.pct}%` }}
                            />
                          </div>
                          <span className="text-slate-700 tabular-nums">
                            {r.completion.approvedRequired}/{r.completion.totalRequired}
                          </span>
                          <span className="text-slate-500 tabular-nums">
                            ({r.completion.pct}%)
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2 text-xs">
                          {r.pendingCount > 0 && (
                            <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 px-2 py-0.5">
                              {r.pendingCount} pending
                            </span>
                          )}
                          {r.expiredCount > 0 && (
                            <span className="inline-flex items-center rounded-full bg-slate-200 text-slate-700 px-2 py-0.5">
                              {r.expiredCount} expired
                            </span>
                          )}
                          {isComplete && r.pendingCount === 0 && r.expiredCount === 0 && (
                            <span className="inline-flex items-center rounded-full bg-green-100 text-green-800 px-2 py-0.5">
                              Up to date
                            </span>
                          )}
                          {!isComplete && r.pendingCount === 0 && r.expiredCount === 0 && (
                            <span className="text-slate-500">Missing uploads</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600 tabular-nums">
                        {formatDate(r.lastActivityAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          href={`/admin/teachers/${r.user.id}`}
                          className="text-blue-700 hover:underline"
                        >
                          Review →
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-slate-500 mt-4">
          Showing {rows.length} teacher{rows.length === 1 ? "" : "s"}.
        </p>
      </main>
    </>
  );
}
