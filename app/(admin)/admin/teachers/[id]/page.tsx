import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/guards";
import { AdminNav } from "@/components/admin/nav";
import { ReviewActions } from "@/components/admin/review-actions";
import { StatusBadge } from "@/components/status-badge";
import { ReinviteTeacher } from "@/components/admin/reinvite-teacher";
import { getTeacherDetail } from "@/lib/db/queries/admin-teachers";
import { deriveUiStatus } from "@/lib/expiry";
import { NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";

function formatDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
}

export default async function TeacherDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAdmin();
  const { id } = await params;

  let detail;
  try {
    detail = await getTeacherDetail({ role: user.role }, id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  const { user: teacher, profile, documents } = detail;

  return (
    <>
      <AdminNav email={user.email} active="teachers" />
      <main className="flex-1 p-6 max-w-6xl mx-auto w-full">
        <div className="mb-4">
          <Link href="/admin/teachers" className="text-sm text-blue-700 hover:underline">
            ← Back to teachers
          </Link>
        </div>

        <section className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
          <h1 className="text-2xl font-semibold text-slate-900">{teacher.name}</h1>
          <p className="text-slate-600">{teacher.email}</p>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 text-sm">
            <div>
              <dt className="text-slate-500">Phone</dt>
              <dd className="text-slate-900">{profile.phone ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Hire date</dt>
              <dd className="text-slate-900">
                {profile.hireDate ? new Date(profile.hireDate).toLocaleDateString() : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Grade level</dt>
              <dd className="text-slate-900">{profile.gradeLevel ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Account created</dt>
              <dd className="text-slate-900">
                {teacher.mustChangePassword ? (
                  "No (Account Creation Pending)"
                ) : (
                  <>
                    Yes
                    {teacher.activatedAt ? (
                      <span className="text-slate-500">
                        {" "}
                        · {formatDate(teacher.activatedAt)}
                      </span>
                    ) : null}
                  </>
                )}
              </dd>
            </div>
          </dl>

          {teacher.mustChangePassword ? (
            <div className="mt-6 border-t border-slate-200 pt-4">
              <h2 className="text-sm font-medium text-slate-900">Account activation pending</h2>
              <p className="mt-1 text-sm text-slate-600">
                This teacher hasn&apos;t created their password yet. Re-invite to generate a new
                temporary password — the previous one stops working immediately.
              </p>
              <div className="mt-3">
                <ReinviteTeacher teacherId={teacher.id} />
              </div>
            </div>
          ) : null}
        </section>

        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <header className="px-6 py-4 border-b border-slate-200">
            <h2 className="text-lg font-medium text-slate-900">Documents</h2>
            <p className="text-sm text-slate-600">
              Current uploads only. Superseded versions are kept for audit but hidden here.
            </p>
          </header>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Document type</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Uploaded</th>
                <th className="text-left px-4 py-3 font-medium">Reviewed</th>
                <th className="text-left px-4 py-3 font-medium">Expires</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {documents.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    This teacher hasn&apos;t uploaded any documents yet.
                  </td>
                </tr>
              ) : (
                documents.map((d) => (
                  <tr key={d.id} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">
                        {d.documentType?.name ?? "Unknown type"}
                      </div>
                      <div className="text-xs text-slate-500 break-all">
                        {d.originalFilename}
                      </div>
                      {d.status === "rejected" && d.rejectionReason && (
                        <div className="text-xs text-red-700 mt-1">
                          Reason: {d.rejectionReason}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={deriveUiStatus(d)} />
                    </td>
                    <td className="px-4 py-3 text-slate-600 tabular-nums">
                      {formatDate(d.uploadedAt)}
                    </td>
                    <td className="px-4 py-3 text-slate-600 tabular-nums">
                      {formatDate(d.reviewedAt)}
                    </td>
                    <td className="px-4 py-3 text-slate-600 tabular-nums">
                      {formatDate(d.expiresAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-2 items-end">
                        <a
                          href={`/api/files/${d.id}`}
                          className="text-blue-700 hover:underline text-sm"
                        >
                          Download
                        </a>
                        {d.status === "pending" && <ReviewActions documentId={d.id} />}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </main>
    </>
  );
}
