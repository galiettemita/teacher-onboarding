import Link from "next/link";
import { requireTeacherReady } from "@/lib/auth/guards";
import { signOut } from "@/lib/auth/config";
import { listMyDocumentTypesWithStatus } from "@/lib/db/queries/teacher-documents";
import { ProgressCard } from "@/components/teacher/progress-card";
import { DocumentCard } from "@/components/teacher/document-card";

/**
 * Teacher dashboard — one card per active document type, derived UI status,
 * and a progress summary across required docs. Server-rendered: the page
 * calls into the data layer directly, and child Client Components handle
 * the modal/upload UX.
 */
export const dynamic = "force-dynamic";

export default async function TeacherDashboard() {
  const user = await requireTeacherReady();
  const entries = await listMyDocumentTypesWithStatus(user);

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/login" });
  }

  return (
    <main className="flex-1 p-6 max-w-5xl mx-auto w-full">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Welcome, {user.name}
          </h1>
          <p className="text-slate-600">
            Upload your documents and track their status here.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/teacher/documents"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            My documents
          </Link>
          <form action={logout}>
            <button
              type="submit"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              Sign out
            </button>
          </form>
        </div>
      </header>

      <ProgressCard entries={entries} />

      <section aria-label="Required documents" className="mt-8">
        <h2 className="sr-only">Documents</h2>
        {entries.length === 0 ? (
          <p className="text-slate-600">
            No documents are configured yet. Please check back later.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {entries.map((entry) => (
              <DocumentCard key={entry.documentType.id} entry={entry} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
