import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guards";
import { AdminNav } from "@/components/admin/nav";
import { getDashboardSummary } from "@/lib/db/queries/admin-teachers";
import { getExpirationCounts } from "@/lib/db/queries/expiration";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const user = await requireAdmin();
  const summary = await getDashboardSummary({ role: user.role });
  const expiration = await getExpirationCounts({ role: user.role });

  const tiles: Array<{ label: string; value: number; href?: string; tone?: string }> = [
    { label: "Total teachers", value: summary.totalTeachers, href: "/admin/teachers" },
    {
      label: "Complete",
      value: summary.completeTeachers,
      href: "/admin/teachers?status=complete",
      tone: "text-green-700",
    },
    {
      label: "Incomplete",
      value: summary.incompleteTeachers,
      href: "/admin/teachers?status=incomplete",
      tone: "text-amber-700",
    },
    {
      label: "Pending reviews",
      value: summary.pendingReviews,
      href: "/admin/teachers?status=incomplete",
      tone: "text-amber-700",
    },
    {
      label: "Expired documents",
      value: expiration.expired,
      href: "/admin/expirations",
      tone: "text-rose-700",
    },
    {
      label: "Expiring soon",
      value: expiration.expiringSoon,
      href: "/admin/expirations",
      tone: "text-orange-700",
    },
  ];

  return (
    <>
      <AdminNav email={user.email} active="dashboard" />
      <main className="flex-1 p-6 max-w-6xl mx-auto w-full">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
          <Link
            href="/admin/teachers/new"
            className="rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2"
          >
            Invite teacher
          </Link>
        </div>

        <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
          {tiles.map((t) => {
            const card = (
              <div className="bg-white rounded-xl border border-slate-200 p-5 h-full">
                <div className="text-sm text-slate-600">{t.label}</div>
                <div className={`mt-2 text-3xl font-semibold ${t.tone ?? "text-slate-900"}`}>
                  {t.value}
                </div>
              </div>
            );
            return t.href ? (
              <Link key={t.label} href={t.href} className="block hover:opacity-90">
                {card}
              </Link>
            ) : (
              <div key={t.label}>{card}</div>
            );
          })}
        </section>

        <section className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-lg font-medium text-slate-900 mb-2">Next steps</h2>
          <ul className="text-slate-600 text-sm space-y-1 list-disc list-inside">
            <li>
              Open the <Link href="/admin/teachers" className="text-blue-700 hover:underline">teacher list</Link> to review uploads.
            </li>
            <li>
              Manage required paperwork in <Link href="/admin/document-types" className="text-blue-700 hover:underline">document types</Link>.
            </li>
          </ul>
        </section>
      </main>
    </>
  );
}
