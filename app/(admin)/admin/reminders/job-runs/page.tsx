import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guards";
import { AdminNav } from "@/components/admin/nav";
import {
  listRecentJobRuns,
  REMINDER_JOB_NAME,
} from "@/lib/db/queries/job-runs";

export const dynamic = "force-dynamic";

function fmt(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().replace("T", " ").slice(0, 19) + "Z";
}

export default async function AdminRemindersJobRunsPage() {
  const user = await requireAdmin();
  const rows = await listRecentJobRuns({ role: user.role }, REMINDER_JOB_NAME, 100);

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
          Cron job runs
        </h1>

        {rows.length === 0 ? (
          <p className="text-slate-500">
            No runs yet. The cron has not been invoked, or it has been invoked
            but never reached the route handler — check Vercel&apos;s cron logs.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="py-2 px-3 font-medium">Started</th>
                  <th className="py-2 px-3 font-medium">Finished</th>
                  <th className="py-2 px-3 font-medium">Status</th>
                  <th className="py-2 px-3 font-medium text-right">Considered</th>
                  <th className="py-2 px-3 font-medium text-right">Sent</th>
                  <th className="py-2 px-3 font-medium text-right">Skipped</th>
                  <th className="py-2 px-3 font-medium text-right">Failed</th>
                  <th className="py-2 px-3 font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="py-2 px-3 whitespace-nowrap text-slate-700">
                      {fmt(r.startedAt)}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap text-slate-700">
                      {fmt(r.finishedAt)}
                    </td>
                    <td className="py-2 px-3">
                      <span
                        className={
                          r.status === "success"
                            ? "text-green-700"
                            : r.status === "failed"
                            ? "text-red-700"
                            : "text-slate-600"
                        }
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      {r.candidatesConsidered}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      {r.emailsSent}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      {r.emailsSkipped}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      {r.emailsFailed}
                    </td>
                    <td className="py-2 px-3 text-xs text-red-700 max-w-md truncate">
                      {r.errorMessage ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
