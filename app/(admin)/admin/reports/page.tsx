import { requireAdmin } from "@/lib/auth/guards";
import { AdminNav } from "@/components/admin/nav";

export const dynamic = "force-dynamic";

interface ReportCard {
  type: "completion" | "expiry";
  title: string;
  description: string;
}

const CARDS: ReportCard[] = [
  {
    type: "completion",
    title: "Teacher completion",
    description:
      "One row per teacher: completion percentage, expired count, and expiring-soon count.",
  },
  {
    type: "expiry",
    title: "Document expiry",
    description:
      "One row per currently-approved document with its expiry date and whether it's expiring soon.",
  },
];

export default async function AdminReportsPage() {
  const user = await requireAdmin();

  return (
    <>
      <AdminNav email={user.email} active="reports" />
      <main className="flex-1 p-6 max-w-6xl mx-auto w-full">
        <h1 className="text-2xl font-semibold text-slate-900 mb-2">Reports</h1>
        <p className="text-sm text-slate-600 mb-6">
          CSV exports are streamed directly from your browser. Each download
          is recorded in the audit log.
        </p>

        <div className="grid sm:grid-cols-2 gap-4">
          {CARDS.map((c) => (
            <div
              key={c.type}
              className="rounded-md border border-slate-200 bg-white p-4 flex flex-col"
            >
              <h2 className="font-semibold text-slate-900 mb-1">{c.title}</h2>
              <p className="text-sm text-slate-600 flex-1">{c.description}</p>
              <a
                href={`/api/admin/reports?type=${c.type}`}
                className="mt-4 inline-flex items-center justify-center rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 self-start"
                download
              >
                Download CSV
              </a>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
