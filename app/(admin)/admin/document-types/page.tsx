import { requireAdmin } from "@/lib/auth/guards";
import { AdminNav } from "@/components/admin/nav";
import { DocumentTypesManager } from "@/components/admin/document-types-manager";
import { listDocumentTypes } from "@/lib/db/queries/document-types";

export default async function DocumentTypesPage() {
  const user = await requireAdmin();
  const rows = await listDocumentTypes({ role: user.role });

  return (
    <>
      <AdminNav email={user.email} active="doc-types" />
      <main className="flex-1 p-6 max-w-6xl mx-auto w-full">
        <h1 className="text-2xl font-semibold text-slate-900 mb-2">Document types</h1>
        <p className="text-slate-600 mb-6 text-sm max-w-2xl">
          These define the paperwork every teacher must upload. Deactivating a type hides
          it from teachers&apos; dashboards but keeps it visible on historical records.
        </p>
        <DocumentTypesManager
          initial={rows.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            required: r.required,
            renewalMonths: r.renewalMonths,
            applicability: r.applicability as
              | "all_staff"
              | "new_first_year_only"
              | "returning_staff_only",
            category: r.category as "medical" | "training" | "general" | "other",
            active: r.active,
          }))}
        />
      </main>
    </>
  );
}
