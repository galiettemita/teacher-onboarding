import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guards";
import { AdminNav } from "@/components/admin/nav";
import { getReminderSettings } from "@/lib/db/queries/reminder-settings";
import {
  listRecentJobRuns,
  REMINDER_JOB_NAME,
} from "@/lib/db/queries/job-runs";

export const dynamic = "force-dynamic";

export default async function AdminRemindersPage() {
  const user = await requireAdmin();
  const [settings, recentRuns] = await Promise.all([
    getReminderSettings(),
    listRecentJobRuns({ role: user.role }, REMINDER_JOB_NAME, 5),
  ]);

  const lastRun = recentRuns[0];

  return (
    <>
      <AdminNav email={user.email} active="reminders" />
      <main className="max-w-6xl mx-auto px-6 py-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold text-slate-900">
                Reminder emails
              </h1>
              <span
                className={
                  "rounded-full px-3 py-1 text-sm font-medium " +
                  (settings.enabled
                    ? "bg-green-100 text-green-800"
                    : "bg-amber-100 text-amber-800")
                }
              >
                {settings.enabled ? "ON" : "OFF"}
              </span>
            </div>
            <p className="text-slate-600 mt-2 max-w-2xl">
              Automated emails remind teachers about missing, rejected, expiring,
              and expired documents. Every attempt is logged.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/reminders/preview"
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Preview emails
            </Link>
            <Link
              href="/admin/reminders/settings"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Edit settings
            </Link>
          </div>
        </header>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="rounded-lg border border-slate-200 p-5 bg-white">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Step 1
            </div>
            <h2 className="font-medium text-slate-900 mt-1 mb-1">Configure</h2>
            <p className="text-sm text-slate-600">
              Set sender, portal URL, reminder days, and the daily cap.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 p-5 bg-white">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Step 2
            </div>
            <h2 className="font-medium text-slate-900 mt-1 mb-1">Cron sends</h2>
            <p className="text-sm text-slate-600">
              The scheduled job finds eligible teachers and sends the right template.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 p-5 bg-white">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Step 3
            </div>
            <h2 className="font-medium text-slate-900 mt-1 mb-1">Monitor</h2>
            <p className="text-sm text-slate-600">
              Check runs and send logs when someone asks what went out.
            </p>
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <Link
            href="/admin/reminders/manual"
            className="rounded-lg border border-blue-200 bg-blue-50 p-5 hover:bg-blue-100"
          >
            <h2 className="font-medium text-blue-950 mb-1">Send one manually</h2>
            <p className="text-sm text-blue-900">
              Choose a teacher, load their documents, and send a one-off reminder.
            </p>
          </Link>
          <Link
            href="/admin/reminders/logs"
            className="rounded-lg border border-slate-200 p-5 hover:bg-slate-50"
          >
            <h2 className="font-medium text-slate-900 mb-1">Open send log</h2>
            <p className="text-sm text-slate-600">
              Review each attempted send, including skipped and failed reminders.
            </p>
          </Link>
        </section>

        <section className="rounded-lg border border-slate-200 p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-medium text-slate-900">Recent cron runs</h2>
            <Link
              href="/admin/reminders/job-runs"
              className="text-sm text-blue-600 hover:underline"
            >
              View all
            </Link>
          </div>
          {recentRuns.length === 0 ? (
            <p className="text-sm text-slate-500">No runs yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr>
                  <th className="py-2 font-medium">Started</th>
                  <th className="py-2 font-medium">Status</th>
                  <th className="py-2 font-medium text-right">Sent</th>
                  <th className="py-2 font-medium text-right">Skipped</th>
                  <th className="py-2 font-medium text-right">Failed</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100">
                    <td className="py-2 text-slate-700">
                      {r.startedAt.toISOString().replace("T", " ").slice(0, 19)}Z
                    </td>
                    <td className="py-2">
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
                    <td className="py-2 text-right tabular-nums">
                      {r.emailsSent}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {r.emailsSkipped}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {r.emailsFailed}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {lastRun?.errorMessage ? (
            <p className="mt-3 text-sm text-red-700">
              Last error: {lastRun.errorMessage}
            </p>
          ) : null}
        </section>
      </main>
    </>
  );
}
