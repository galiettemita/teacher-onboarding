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
        <header className="flex items-baseline justify-between mb-6">
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
            {settings.enabled ? "Reminders ON" : "Reminders OFF"}
          </span>
        </header>

        <p className="text-slate-600 mb-8">
          The portal sends scheduled email reminders to teachers about missing,
          rejected, expiring, and expired documents. Sends are logged so you can
          see what went out, what was skipped, and what failed.
        </p>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <Link
            href="/admin/reminders/settings"
            className="rounded-lg border border-slate-200 p-5 hover:bg-slate-50"
          >
            <h2 className="font-medium text-slate-900 mb-1">Settings</h2>
            <p className="text-sm text-slate-600">
              Turn reminders on/off, edit sender, portal URL, and milestone days.
            </p>
          </Link>
          <Link
            href="/admin/reminders/logs"
            className="rounded-lg border border-slate-200 p-5 hover:bg-slate-50"
          >
            <h2 className="font-medium text-slate-900 mb-1">Send log</h2>
            <p className="text-sm text-slate-600">
              Every reminder the system attempted, with status and reason.
            </p>
          </Link>
          <Link
            href="/admin/reminders/preview"
            className="rounded-lg border border-slate-200 p-5 hover:bg-slate-50"
          >
            <h2 className="font-medium text-slate-900 mb-1">Preview templates</h2>
            <p className="text-sm text-slate-600">
              See what each reminder type looks like. No emails are sent.
            </p>
          </Link>
          <Link
            href="/admin/reminders/manual"
            className="rounded-lg border border-slate-200 p-5 hover:bg-slate-50"
          >
            <h2 className="font-medium text-slate-900 mb-1">Send manually</h2>
            <p className="text-sm text-slate-600">
              One-off send to a specific teacher. Bypasses the daily cap.
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
