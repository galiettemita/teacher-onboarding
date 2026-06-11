import Link from "next/link";
import { requireTeacherReady } from "@/lib/auth/guards";
import { listMyDocumentsWithType } from "@/lib/db/queries/teacher-documents";
import { StatusBadge } from "@/components/status-badge";
import { deriveUiStatus } from "@/lib/expiry";

export const dynamic = "force-dynamic";

/**
 * Full history of the teacher's uploads, including superseded rows. The
 * Download link is a plain anchor pointed at `/api/files/[id]` — the route
 * handler enforces auth, ownership, and the correct headers; the link
 * itself never carries a storage URL.
 */
export default async function TeacherDocumentsPage() {
  const user = await requireTeacherReady();
  const docs = await listMyDocumentsWithType(user);

  return (
    <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">My documents</h1>
          <p className="text-slate-600">Every file you have uploaded.</p>
        </div>
        <Link
          href="/teacher/dashboard"
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          Back to dashboard
        </Link>
      </header>

      {docs.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-slate-600 shadow-sm">
          You haven&apos;t uploaded anything yet.{" "}
          <Link
            href="/teacher/dashboard"
            className="font-medium text-blue-700 underline"
          >
            Go to the dashboard
          </Link>{" "}
          to upload your first document.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-600">
                <th scope="col" className="px-4 py-3 font-medium">Type</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 font-medium">Uploaded</th>
                <th scope="col" className="px-4 py-3 font-medium">Expires</th>
                <th scope="col" className="px-4 py-3 font-medium">
                  <span className="sr-only">Download</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {docs.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-3 text-slate-900">{d.documentTypeName}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={deriveUiStatus(d)} />
                  </td>
                  <td className="px-4 py-3 text-slate-700">{formatDate(d.uploadedAt)}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {d.expiresAt ? formatDate(d.expiresAt) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={`/api/files/${d.id}`}
                      className="font-medium text-blue-700 underline focus:outline-none focus:ring-2 focus:ring-blue-500"
                      aria-label={`Download ${d.documentTypeName} (${d.originalFilename})`}
                    >
                      Download
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
