import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guards";
import { AdminNav } from "@/components/admin/nav";
import { StatusBadge } from "@/components/status-badge";
import { listExpirationAlerts } from "@/lib/db/queries/expiration";

export const dynamic = "force-dynamic";

function formatDate(d: Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "12 days left" / "5 days overdue" / "due today". */
function timing(daysRemaining: number | null): string {
  if (daysRemaining === null) return "—";
  if (daysRemaining > 0) return `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} left`;
  if (daysRemaining < 0) {
    const n = Math.abs(daysRemaining);
    return `${n} day${n === 1 ? "" : "s"} overdue`;
  }
  return "due today";
}

export default async function ExpirationsPage() {
  const user = await requireAdmin();
  const alerts = await listExpirationAlerts({ role: user.role });

  const expired = alerts.filter((a) => a.state === "expired");
  const expiringSoon = alerts.filter((a) => a.state === "expiring_soon");

  return (
    <>
      <AdminNav email={user.email} active="expirations" />
      <main className="flex-1 p-6 max-w-6xl mx-auto w-full">
        <h1 className="text-2xl font-semibold text-slate-900 mb-2">
          Expired &amp; expiring documents
        </h1>
        <p className="text-slate-600 mb-6 text-sm max-w-2xl">
          Medical forms and training certifications expire every two years. This page lists
          every document that has expired or is expiring soon, so you know who needs to send
          in an updated copy.
        </p>

        <section className="grid grid-cols-2 gap-4 mb-8 max-w-md">
          <div className="bg-white rounded-xl border border-rose-200 p-5">
            <div className="text-sm text-slate-600">Expired</div>
            <div className="mt-2 text-3xl font-semibold text-rose-700">{expired.length}</div>
          </div>
          <div className="bg-white rounded-xl border border-orange-200 p-5">
            <div className="text-sm text-slate-600">Expiring soon</div>
            <div className="mt-2 text-3xl font-semibold text-orange-700">
              {expiringSoon.length}
            </div>
          </div>
        </section>

        {alerts.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-slate-500">
            Nothing is expired or expiring soon right now. 🎉
          </div>
        ) : (
          <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Teacher</th>
                  <th className="text-left px-4 py-3 font-medium">Document</th>
                  <th className="text-left px-4 py-3 font-medium">Submitted</th>
                  <th className="text-left px-4 py-3 font-medium">Expires</th>
                  <th className="text-left px-4 py-3 font-medium">Timing</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.documentId} className="border-t border-slate-100">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{a.teacherName}</div>
                      <div className="text-xs text-slate-500">{a.teacherEmail}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{a.documentTypeName}</td>
                    <td className="px-4 py-3 text-slate-600 tabular-nums">
                      {formatDate(a.uploadedAt)}
                    </td>
                    <td className="px-4 py-3 text-slate-600 tabular-nums">
                      {formatDate(a.expiresAt)}
                    </td>
                    <td
                      className={
                        "px-4 py-3 tabular-nums " +
                        (a.state === "expired" ? "text-rose-700" : "text-orange-700")
                      }
                    >
                      {timing(a.daysRemaining)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={a.state} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/teachers/${a.teacherId}`}
                        className="text-blue-700 hover:underline text-sm"
                      >
                        View teacher
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </main>
    </>
  );
}
